import './env.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from './db/index.ts'
import { settings, sites, siteUrls, submissions } from './db/schema.ts'
import {
  latestSubmissionsForSites,
  mismatchCountsForSites,
  runSubmission,
  statusExpr,
  syncSitemap,
  URL_STATUSES,
  urlCounts,
  urlCountsForSites,
} from './indexnow.ts'
import { getCronProgress, nextRunFor } from './cron.ts'
import { appVersion } from './version.ts'

function enrichSite(site: typeof sites.$inferSelect) {
  const lastBySite = latestSubmissionsForSites([site.id])
  const countsBySite = urlCountsForSites([site.id])
  const mismatchBySite = mismatchCountsForSites([site.id])
  return {
    ...site,
    lastSubmission: lastBySite.get(site.id) ?? null,
    urlCounts: countsBySite.get(site.id) ?? { new: 0, updated: 0, submitted: 0, removed: 0, total: 0, pending: 0 },
    nextRunAt: site.submissionLevel === 'scheduled' ? nextRunFor(site.cronInterval) : null,
    mismatchedCount: mismatchBySite.get(site.id) ?? 0,
  }
}

const server = new McpServer({
  name: 'index-now-server',
  version: appVersion,
})

// --- Tools ---

server.tool('list_sites', 'List all sites with URL counts and submission status', {}, async () => {
  const all = db.select().from(sites).all()
  const data = all.map(enrichSite)
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
})

server.tool(
  'get_site',
  'Get a single site by ID with full stats',
  { siteId: z.string().describe('Site UUID') },
  async ({ siteId }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }
    return { content: [{ type: 'text', text: JSON.stringify(enrichSite(site), null, 2) }] }
  },
)

server.tool(
  'get_site_urls',
  'List URLs for a site with optional search and status filter',
  {
    siteId: z.string().describe('Site UUID'),
    q: z.string().optional().describe('Search URLs containing this text'),
    status: z.enum(URL_STATUSES as unknown as [string, ...string[]]).optional().describe('Filter by status'),
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

server.tool(
  'submit_site',
  'Trigger IndexNow submission for a site (submits all pending URLs)',
  { siteId: z.string().describe('Site UUID') },
  async ({ siteId }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }
    if (!site.keyVerified) {
      return { content: [{ type: 'text', text: 'IndexNow key not verified. Verify the key first.' }], isError: true }
    }
    const result = await runSubmission(site, 'manual')
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'sync_sitemap',
  'Refresh URL data from the sitemap without submitting',
  { siteId: z.string().describe('Site UUID') },
  async ({ siteId }) => {
    const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
    if (!site) return { content: [{ type: 'text', text: 'Site not found' }], isError: true }
    const result = await syncSitemap(site)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'get_submissions',
  'Get recent submission history for a site',
  {
    siteId: z.string().describe('Site UUID'),
    limit: z.number().min(1).max(100).default(20).describe('Number of submissions to return'),
  },
  async ({ siteId, limit }) => {
    const rows = db
      .select()
      .from(submissions)
      .where(eq(submissions.siteId, siteId))
      .orderBy(desc(submissions.createdAt))
      .limit(limit)
      .all()
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] }
  },
)

server.tool('get_cron_status', 'Get current cron job progress', {}, async () => {
  return { content: [{ type: 'text', text: JSON.stringify(getCronProgress(), null, 2) }] }
})

server.tool('get_version', 'Get server version', {}, async () => {
  return { content: [{ type: 'text', text: JSON.stringify({ version: appVersion }, null, 2) }] }
})

// --- Resources ---

server.resource(
  'sites',
  'indexnow://sites',
  { description: 'All configured sites and their current status' },
  async () => {
    const all = db.select().from(sites).all()
    const data = all.map(enrichSite)
    return { contents: [{ uri: 'indexnow://sites', text: JSON.stringify(data, null, 2), mimeType: 'application/json' }] }
  },
)

// --- Start ---

const transport = new StdioServerTransport()
await server.connect(transport)
