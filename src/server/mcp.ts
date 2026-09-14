import './env.ts'
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db/index.ts'
import { settings, sites, siteUrls, submissions } from './db/schema.ts'
import {
  discoverSitemaps,
  DRY_RUN,
  latestSubmissionsForSites,
  mismatchCountsForSites,
  runSubmission,
  statusExpr,
  syncSitemap,
  URL_STATUSES,
  urlCounts,
  urlCountsForSites,
  verifyKeyDeployment,
} from './indexnow.ts'
import { getCronProgress, nextRunFor } from './cron.ts'
import { appVersion } from './version.ts'

function enrichSite(site: typeof sites.$inferSelect) {
  const ids = [site.id]
  const lastBySite = latestSubmissionsForSites(ids)
  const countsBySite = urlCountsForSites(ids)
  const mismatchBySite = mismatchCountsForSites(ids)
  return {
    id: site.id,
    name: site.name,
    host: site.host,
    sitemapUrl: site.sitemapUrl,
    submissionLevel: site.submissionLevel,
    cronInterval: site.cronInterval,
    keyVerified: site.keyVerified,
    keyVerifiedAt: site.keyVerifiedAt,
    lastSyncAt: site.lastSyncAt,
    sitemapCount: site.sitemapCount,
    urlCounts: countsBySite.get(site.id) ?? { new: 0, updated: 0, submitted: 0, removed: 0, total: 0, pending: 0 },
    lastSubmission: lastBySite.get(site.id) ?? null,
    nextRunAt: site.submissionLevel === 'scheduled' ? nextRunFor(site.cronInterval) : null,
    mismatchedCount: mismatchBySite.get(site.id) ?? 0,
  }
}

function enrichSiteBatched(
  site: typeof sites.$inferSelect,
  lastBySite: Map<string, typeof submissions.$inferSelect>,
  countsBySite: ReturnType<typeof urlCountsForSites>,
  mismatchBySite: Map<string, number>,
) {
  return {
    id: site.id,
    name: site.name,
    host: site.host,
    sitemapUrl: site.sitemapUrl,
    submissionLevel: site.submissionLevel,
    cronInterval: site.cronInterval,
    keyVerified: site.keyVerified,
    lastSyncAt: site.lastSyncAt,
    urlCounts: countsBySite.get(site.id) ?? { new: 0, updated: 0, submitted: 0, removed: 0, total: 0, pending: 0 },
    lastSubmission: lastBySite.get(site.id) ?? null,
    nextRunAt: site.submissionLevel === 'scheduled' ? nextRunFor(site.cronInterval) : null,
    mismatchedCount: mismatchBySite.get(site.id) ?? 0,
  }
}

const API_REFERENCE = [
  { method: 'GET', path: '/api/sites', description: 'List all sites with URL counts and submission status' },
  { method: 'GET', path: '/api/sites/:id', description: 'Single site with full stats' },
  { method: 'POST', path: '/api/sites', description: 'Add a site (body: name, host, sitemapUrl, optional apiKey/submissionLevel/cronInterval)' },
  { method: 'PATCH', path: '/api/sites/:id', description: 'Update site settings (submissionLevel, cronInterval, sitemapUrl, name)' },
  { method: 'DELETE', path: '/api/sites/:id', description: 'Remove a site and all its URLs' },
  { method: 'POST', path: '/api/sites/:id/sync', description: 'Refresh URLs from sitemap without submitting' },
  { method: 'POST', path: '/api/sites/:id/submit', description: 'Submit pending URLs to search engines (optional body: {urls: string[]})' },
  { method: 'POST', path: '/api/sites/:id/verify-key', description: 'Check if IndexNow key file is deployed at host' },
  { method: 'POST', path: '/api/sites/:id/rotate-key', description: 'Generate new IndexNow key' },
  { method: 'GET', path: '/api/sites/:id/urls', description: 'Paginated URL list (query: q, status, limit, offset)' },
  { method: 'GET', path: '/api/sites/:id/submissions', description: 'Submission history for a site' },
  { method: 'POST', path: '/api/sites/:id/urls/reset', description: 'Reset all URL statuses to pending' },
  { method: 'POST', path: '/api/sites/:id/urls/bulk-delete', description: 'Delete URLs by ID (body: {ids: number[]})' },
  { method: 'DELETE', path: '/api/sites/:id/urls?all=true', description: 'Delete all URLs for a site' },
  { method: 'DELETE', path: '/api/sites/:id/urls?status=removed', description: 'Prune removed URLs' },
  { method: 'POST', path: '/api/sites/:id/sitemap-scope', description: 'Set excluded child sitemaps (body: {excludedSitemaps: string[]})' },
  { method: 'POST', path: '/api/sites/:id/sitemap-fix', description: 'Update sitemap URL (body: {sitemapUrl: string})' },
  { method: 'POST', path: '/api/sites/discover', description: 'Auto-discover sitemaps from a domain (body: {url: string})' },
  { method: 'GET', path: '/api/cron/status', description: 'Current cron job progress' },
  { method: 'GET', path: '/api/settings', description: 'App settings (discord, webhook secret, dry-run state)' },
  { method: 'PUT', path: '/api/settings', description: 'Update settings' },
  { method: 'GET', path: '/api/version', description: 'Server version' },
  { method: 'POST', path: '/hook/:siteId', description: 'Public webhook trigger (header: X-Webhook-Secret)' },
]

const server = new McpServer({
  name: 'index-now-server',
  version: appVersion,
})

// --- Project-level tools ---

server.tool(
  'get_overview',
  'Full project overview: all sites with stats, cron status, settings, version, and API reference. Call this first.',
  {},
  async () => {
    const all = db.select().from(sites).all()
    const ids = all.map((s) => s.id)
    const lastBySite = latestSubmissionsForSites(ids)
    const countsBySite = urlCountsForSites(ids)
    const mismatchBySite = mismatchCountsForSites(ids)
    const siteData = all.map((s) => enrichSiteBatched(s, lastBySite, countsBySite, mismatchBySite))

    const settingsRow = db.select().from(settings).get()
    const overview = {
      version: appVersion,
      dryRun: DRY_RUN,
      siteCount: all.length,
      sites: siteData,
      cron: getCronProgress(),
      settings: {
        discordConfigured: !!settingsRow?.discordWebhookUrl,
        webhookSecretConfigured: !!settingsRow?.webhookSecret,
        events: settingsRow?.events ?? [],
      },
      api: API_REFERENCE,
    }
    return { content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }] }
  },
)

server.tool(
  'get_site_detail',
  'Full context for one site: config, URL counts, recent submissions, errors, schedule, verification status',
  { siteId: z.string().describe('Site UUID') },
  async ({ siteId }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }

    const enriched = enrichSite(site)
    const recentSubmissions = db
      .select()
      .from(submissions)
      .where(eq(submissions.siteId, siteId))
      .orderBy(desc(submissions.createdAt))
      .limit(10)
      .all()

    const detail = {
      ...enriched,
      apiKey: site.apiKey,
      keyFileUrl: `https://${site.host}/${site.apiKey}.txt`,
      keyFileInstructions: !site.keyVerified
        ? `Deploy a text file at https://${site.host}/${site.apiKey}.txt containing exactly: ${site.apiKey}`
        : null,
      excludedSitemaps: site.excludedSitemaps,
      sitemapChildren: site.sitemapChildren,
      recentSubmissions,
    }
    return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] }
  },
)

// --- Site management tools ---

server.tool(
  'add_site',
  'Add a new site to monitor. Auto-discovers sitemap from robots.txt if not specified.',
  {
    host: z.string().describe('Domain (e.g. example.com)'),
    name: z.string().optional().describe('Display name (defaults to host)'),
    sitemapUrl: z.string().optional().describe('Sitemap URL (auto-discovered if omitted)'),
    submissionLevel: z.enum(['manual', 'scheduled', 'webhook']).default('webhook').describe('How URLs get submitted'),
    cronInterval: z.enum(['hourly', '6h', 'daily', 'weekly', 'monthly']).default('daily').describe('Schedule for "scheduled" level'),
  },
  async ({ host, name, sitemapUrl, submissionLevel, cronInterval }) => {
    let sitemap = sitemapUrl
    if (!sitemap) {
      try {
        const discovered = await discoverSitemaps(host)
        sitemap = discovered.sitemapUrls[0]
        if (!sitemap) return { content: [{ type: 'text', text: `No sitemap found for ${host}. Provide sitemapUrl explicitly.` }], isError: true }
      } catch {
        return { content: [{ type: 'text', text: `Could not reach ${host} to discover sitemap. Provide sitemapUrl explicitly.` }], isError: true }
      }
    }

    const site = db
      .insert(sites)
      .values({
        name: name ?? host,
        host,
        sitemapUrl: sitemap,
        apiKey: randomBytes(16).toString('hex'),
        submissionLevel,
        cronInterval,
      })
      .returning()
      .get()

    const enriched = enrichSite(site)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ...enriched,
          apiKey: site.apiKey,
          keyFileUrl: `https://${site.host}/${site.apiKey}.txt`,
          keyFileInstructions: `Deploy a text file at https://${site.host}/${site.apiKey}.txt containing exactly: ${site.apiKey}`,
          nextStep: 'Deploy the key file, then call verify_key to confirm.',
        }, null, 2),
      }],
    }
  },
)

server.tool(
  'update_site',
  'Change site settings: submission level, cron interval, sitemap URL, or name',
  {
    siteId: z.string().describe('Site UUID'),
    name: z.string().optional().describe('New display name'),
    sitemapUrl: z.string().optional().describe('New sitemap URL'),
    submissionLevel: z.enum(['manual', 'scheduled', 'webhook']).optional().describe('Submission mode'),
    cronInterval: z.enum(['hourly', '6h', 'daily', 'weekly', 'monthly']).optional().describe('Cron schedule'),
  },
  async ({ siteId, ...updates }) => {
    const fields: Record<string, unknown> = {}
    if (updates.name !== undefined) fields.name = updates.name
    if (updates.sitemapUrl !== undefined) fields.sitemapUrl = updates.sitemapUrl
    if (updates.submissionLevel !== undefined) fields.submissionLevel = updates.submissionLevel
    if (updates.cronInterval !== undefined) fields.cronInterval = updates.cronInterval

    if (Object.keys(fields).length === 0) {
      return { content: [{ type: 'text', text: 'No fields to update. Provide at least one of: name, sitemapUrl, submissionLevel, cronInterval.' }], isError: true }
    }

    const updated = db
      .update(sites)
      .set(fields as Partial<typeof sites.$inferInsert>)
      .where(eq(sites.id, siteId))
      .returning()
      .get()
    if (!updated) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }
    return { content: [{ type: 'text', text: JSON.stringify(enrichSite(updated), null, 2) }] }
  },
)

server.tool(
  'verify_key',
  'Check if the IndexNow key file is deployed. Returns verification result and instructions if not verified.',
  { siteId: z.string().describe('Site UUID') },
  async ({ siteId }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }

    const result = await verifyKeyDeployment(site.host, site.apiKey)
    db.update(sites)
      .set({ keyVerified: result.found, keyVerifiedAt: result.found ? new Date() : null })
      .where(eq(sites.id, siteId))
      .run()

    const response = {
      verified: result.found,
      keyFileUrl: `https://${site.host}/${site.apiKey}.txt`,
      httpStatus: result.statusCode,
      bodyPreview: result.bodyPreview,
      instructions: !result.found
        ? [
            `1. Create a file named ${site.apiKey}.txt`,
            `2. File contents must be exactly: ${site.apiKey}`,
            `3. Deploy to: https://${site.host}/${site.apiKey}.txt`,
            '4. The file must return HTTP 200 with text/plain content type.',
            '5. Call verify_key again after deploying.',
          ]
        : null,
    }
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] }
  },
)

server.tool(
  'submit_urls',
  'Submit pending URLs to search engines for a site. Key must be verified first.',
  { siteId: z.string().describe('Site UUID') },
  async ({ siteId }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }
    if (!site.keyVerified) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Key not verified',
            keyFileUrl: `https://${site.host}/${site.apiKey}.txt`,
            instructions: `Deploy the key file first, then call verify_key. File contents: ${site.apiKey}`,
          }, null, 2),
        }],
        isError: true,
      }
    }
    const result = await runSubmission(site, 'manual')
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'sync_sitemap',
  'Refresh URL data from the sitemap without submitting to search engines',
  { siteId: z.string().describe('Site UUID') },
  async ({ siteId }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }
    const result = await syncSitemap(site)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'get_site_urls',
  'Browse URLs for a site with optional search and status filter',
  {
    siteId: z.string().describe('Site UUID'),
    q: z.string().optional().describe('Search URLs containing this text'),
    status: z.enum(URL_STATUSES as unknown as [string, ...string[]]).optional().describe('Filter by status: new, updated, submitted, removed'),
    limit: z.number().min(1).max(500).default(100).describe('Page size'),
    offset: z.number().min(0).default(0).describe('Offset for pagination'),
  },
  async ({ siteId, q, status, limit, offset }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }
    const expr = statusExpr(site)
    const where = and(
      eq(siteUrls.siteId, siteId),
      q ? like(siteUrls.url, `%${q}%`) : undefined,
      status ? sql`${expr} = ${status}` : undefined,
    )
    const rows = db
      .select({
        id: siteUrls.id,
        url: siteUrls.url,
        lastmod: siteUrls.lastmod,
        submittedAt: siteUrls.submittedAt,
        status: expr,
      })
      .from(siteUrls)
      .where(where)
      .orderBy(desc(siteUrls.id))
      .limit(limit)
      .offset(offset)
      .all()
    const total = db.select({ n: sql<number>`count(*)` }).from(siteUrls).where(where).get()?.n ?? 0
    const counts = urlCounts(site)
    return { content: [{ type: 'text', text: JSON.stringify({ rows, total, counts }, null, 2) }] }
  },
)

// --- Resources ---

server.resource(
  'sites',
  'indexnow://sites',
  { description: 'All configured sites and their current status' },
  async () => {
    const all = db.select().from(sites).all()
    const ids = all.map((s) => s.id)
    const lastBySite = latestSubmissionsForSites(ids)
    const countsBySite = urlCountsForSites(ids)
    const mismatchBySite = mismatchCountsForSites(ids)
    const data = all.map((s) => enrichSiteBatched(s, lastBySite, countsBySite, mismatchBySite))
    return { contents: [{ uri: 'indexnow://sites', text: JSON.stringify(data, null, 2), mimeType: 'application/json' }] }
  },
)

// --- Start ---

const transport = new StdioServerTransport()
await server.connect(transport)
