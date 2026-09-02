import { randomBytes } from 'node:crypto'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { authEnabled, readSession } from '../auth.ts'
import { db } from '../db/index.ts'
import { settings, sites, siteUrls, submissions } from '../db/schema.ts'
import {
  deleteAllUrls,
  deleteUrlsByIds,
  discoverSitemaps,
  DRY_RUN,
  getSitemapWarnings,
  latestSubmissionsForSites,
  mismatchCountsForSites,
  pruneRemovedUrls,
  resetUrlStatuses,
  runSubmission,
  SitemapFetchError,
  statusExpr,
  syncSitemap,
  URL_STATUSES,
  urlCounts,
  urlCountsForSites,
  validateExplicitUrls,
  verifyKeyDeployment,
} from '../indexnow.ts'
import { EVENT_KEYS, sendDiscord } from '../notify.ts'
import { getCronProgress, nextRunFor } from '../cron.ts'
import { curatedChangelog, readChangelog } from '../changelog.ts'
import { getGithubStats } from '../github.ts'
import { appVersion } from '../version.ts'

const siteBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    host: { type: 'string', minLength: 1, maxLength: 253, pattern: '^[a-zA-Z0-9.-]+$' },
    sitemapUrl: { type: 'string', format: 'uri', maxLength: 2000 },
    apiKey: { type: 'string', pattern: '^[a-zA-Z0-9-]{8,128}$' },
    submissionLevel: { type: 'string', enum: ['manual', 'scheduled', 'webhook'] },
    cronInterval: { type: 'string', enum: ['hourly', '6h', 'daily', 'weekly', 'monthly'] },
  },
  additionalProperties: false,
} as const

export async function apiRoutes(app: FastifyInstance) {
  // Session guard for everything registered in this scope (skipped if auth disabled)
  app.addHook('preHandler', async (req, reply) => {
    if (!authEnabled) return
    const email = readSession(req.headers.cookie)
    if (!email) return reply.code(401).send({ error: 'Unauthorized' })
  })

  // --- Sites ---

  app.get('/sites', async () => {
    const all = db.select().from(sites).all()
    const ids = all.map((s) => s.id)
    const lastBySite = latestSubmissionsForSites(ids)
    const countsBySite = urlCountsForSites(ids)
    const mismatchBySite = mismatchCountsForSites(ids)
    return all.map((site) => ({
      ...site,
      lastSubmission: lastBySite.get(site.id) ?? null,
      urlCounts: countsBySite.get(site.id) ?? { new: 0, updated: 0, submitted: 0, removed: 0, total: 0, pending: 0 },
      nextRunAt: site.submissionLevel === 'scheduled' ? nextRunFor(site.cronInterval) : null,
      mismatchedCount: mismatchBySite.get(site.id) ?? 0,
    }))
  })

  app.get('/cron/status', async () => getCronProgress())

  // --- Version & changelog ---

  app.get('/version', async () => ({ version: appVersion }))

  app.get('/github-stats', async () => getGithubStats())

  app.get('/changelog', async () => ({
    version: appVersion,
    curated: curatedChangelog(),
    full: readChangelog(),
  }))

  app.post(
    '/sites',
    { schema: { body: { ...siteBody, required: ['name', 'host', 'sitemapUrl'] } } },
    async (req, reply) => {
      const body = req.body as { name: string; host: string; sitemapUrl: string; apiKey?: string; submissionLevel?: 'manual' | 'scheduled' | 'webhook'; cronInterval?: 'hourly' | '6h' | 'daily' }
      const site = db
        .insert(sites)
        .values({
          ...body,
          // Bring-your-own key (already hosted as {key}.txt) or generate a fresh one
          apiKey: body.apiKey ?? randomBytes(16).toString('hex'),
        })
        .returning()
        .get()
      return reply.code(201).send(site)
    },
  )

  // Sitemap auto-discovery: robots.txt "Sitemap:" lines, then well-known paths
  app.post(
    '/sites/discover',
    {
      schema: {
        body: {
          type: 'object',
          properties: { url: { type: 'string', minLength: 3, maxLength: 2000 } },
          required: ['url'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      try {
        return await discoverSitemaps((req.body as { url: string }).url.trim())
      } catch {
        return reply.code(400).send({ error: 'Invalid URL' })
      }
    },
  )

  app.patch('/sites/:id', { schema: { body: siteBody } }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const updated = db
      .update(sites)
      .set(req.body as Partial<typeof sites.$inferInsert>)
      .where(eq(sites.id, id))
      .returning()
      .get()
    if (!updated) return reply.code(404).send({ error: 'Site not found' })
    return updated
  })

  app.delete('/sites/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const deleted = db.delete(sites).where(eq(sites.id, id)).returning().get()
    if (!deleted) return reply.code(404).send({ error: 'Site not found' })
    return { ok: true }
  })

  app.post('/sites/:id/rotate-key', async (req, reply) => {
    const { id } = req.params as { id: string }
    const updated = db
      .update(sites)
      .set({ apiKey: randomBytes(16).toString('hex') })
      .where(eq(sites.id, id))
      .returning()
      .get()
    if (!updated) return reply.code(404).send({ error: 'Site not found' })
    return updated
  })

  app.post('/sites/:id/submit', async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = db.select().from(sites).where(eq(sites.id, id)).get()
    if (!site) return reply.code(404).send({ error: 'Site not found' })
    if (!site.keyVerified) {
      return reply.code(400).send({ error: 'IndexNow key is not verified for this site. Verify the key before submitting.' })
    }
    const body = req.body as { urls?: string[] } | undefined
    if (body?.urls?.length) {
      const v = validateExplicitUrls(site, body.urls)
      if (v.invalid.length > 0) {
        return reply.code(400).send({
          error: `Rejected ${v.invalid.length} URL(s) not in sitemap or host mismatch`,
          invalid: v.invalid,
        })
      }
    }
    try {
      return await runSubmission(site, 'manual', body?.urls)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Rejected') || msg.includes('host_mismatch') || msg.includes('not_in_sitemap')) {
        return reply.code(400).send({ error: msg })
      }
      throw err
    }
  })

  // Reset submission status for all URLs of a site
  app.post('/sites/:id/urls/reset', async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = db.select().from(sites).where(eq(sites.id, id)).get()
    if (!site) return reply.code(404).send({ error: 'Site not found' })
    const changed = resetUrlStatuses(id)
    return { ok: true, changed, counts: urlCounts(site) }
  })

  // Bulk delete selected URLs
  app.post(
    '/sites/:id/urls/bulk-delete',
    {
      schema: {
        body: {
          type: 'object',
          properties: { ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 5000 } },
          required: ['ids'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const site = db.select().from(sites).where(eq(sites.id, id)).get()
      if (!site) return reply.code(404).send({ error: 'Site not found' })
      const { ids } = req.body as { ids: number[] }
      const deleted = deleteUrlsByIds(id, ids)
      return { ok: true, deleted, counts: urlCounts(site) }
    },
  )

  // Delete all or pruned URLs via query params
  app.delete(
    '/sites/:id/urls',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            all: { type: 'string', enum: ['true', '1'] },
            status: { type: 'string', enum: ['removed'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const site = db.select().from(sites).where(eq(sites.id, id)).get()
      if (!site) return reply.code(404).send({ error: 'Site not found' })
      const { all, status } = req.query as { all?: string; status?: 'removed' }
      let deleted = 0
      if (all) deleted = deleteAllUrls(id)
      else if (status === 'removed') deleted = pruneRemovedUrls(site)
      else return reply.code(400).send({ error: 'Provide ?all=true or ?status=removed or use bulk-delete' })
      return { ok: true, deleted, counts: urlCounts(site) }
    },
  )

  // Refresh URL data from the sitemap without submitting anything
  app.post('/sites/:id/sync', async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = db.select().from(sites).where(eq(sites.id, id)).get()
    if (!site) return reply.code(404).send({ error: 'Site not found' })
    try {
      return await syncSitemap(site)
    } catch (err) {
      if (err instanceof SitemapFetchError) {
        const code = err.statusCode === 404 ? 404 : 502
        return reply.code(code).send({
          error: err.message,
          statusCode: err.statusCode,
          suggestedSitemap: err.suggestedSitemap,
          finalUrl: err.finalUrl,
        })
      }
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Sync failed' })
    }
  })

  // Tree filter: choose which child sitemaps (of a sitemap index) are in scope for sync/submit
  app.post(
    '/sites/:id/sitemap-scope',
    {
      schema: {
        body: {
          type: 'object',
          properties: { excludedSitemaps: { type: 'array', items: { type: 'string' }, maxItems: 500 } },
          required: ['excludedSitemaps'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const { excludedSitemaps } = req.body as { excludedSitemaps: string[] }
      const updated = db.update(sites).set({ excludedSitemaps }).where(eq(sites.id, id)).returning().get()
      if (!updated) return reply.code(404).send({ error: 'Site not found' })
      return updated
    },
  )

  // Update sitemap URL after redirect/404 suggestion
  app.post(
    '/sites/:id/sitemap-fix',
    {
      schema: {
        body: {
          type: 'object',
          properties: { sitemapUrl: { type: 'string', format: 'uri', maxLength: 2000 } },
          required: ['sitemapUrl'],
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const site = db.select().from(sites).where(eq(sites.id, id)).get()
      if (!site) return reply.code(404).send({ error: 'Site not found' })
      const { sitemapUrl } = req.body as { sitemapUrl: string }
      const updated = db.update(sites).set({ sitemapUrl }).where(eq(sites.id, id)).returning().get()
      return updated
    },
  )

  // Verify that the IndexNow key is deployed at https://host/key.txt
  app.post('/sites/:id/verify-key', async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = db.select().from(sites).where(eq(sites.id, id)).get()
    if (!site) return reply.code(404).send({ error: 'Site not found' })
    const result = await verifyKeyDeployment(site.host, site.apiKey)
    // Persist verification status
    db.update(sites)
      .set({ keyVerified: result.found, keyVerifiedAt: result.found ? new Date() : null })
      .where(eq(sites.id, id))
      .run()
    return {
      ...result,
      keyUrl: `https://${site.host}/${site.apiKey}.txt`,
    }
  })

  // Spreadsheet view: paginated per-site URLs with derived status
  app.get(
    '/sites/:id/urls',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 500 },
            status: { type: 'string', enum: URL_STATUSES },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const { q, status, limit, offset } = req.query as {
        q?: string
        status?: (typeof URL_STATUSES)[number]
        limit: number
        offset: number
      }
      const site = db.select().from(sites).where(eq(sites.id, id)).get()
      if (!site) return reply.code(404).send({ error: 'Site not found' })

      const expr = statusExpr(site)
      const where = and(
        eq(siteUrls.siteId, id),
        q ? like(siteUrls.url, `%${q}%`) : undefined,
        status ? sql`${expr} = ${status}` : undefined,
      )
      const rows = db
        .select({
          id: siteUrls.id,
          url: siteUrls.url,
          lastmod: siteUrls.lastmod,
          firstSeenAt: siteUrls.firstSeenAt,
          lastSeenAt: siteUrls.lastSeenAt,
          submittedAt: siteUrls.submittedAt,
          statusCode: siteUrls.statusCode,
          status: expr,
        })
        .from(siteUrls)
        .where(where)
        .orderBy(desc(siteUrls.id))
        .limit(limit)
        .offset(offset)
        .all()
      const total = db.select({ n: sql<number>`count(*)` }).from(siteUrls).where(where).get()?.n ?? 0
      // Warnings cover the whole URL set, not this page's filter/search — only worth the full-table
      // scan on the default (unfiltered, first-page) view where the banner is actually shown.
      const warnings = !q && !status && offset === 0 ? getSitemapWarnings(site) : undefined

      return { rows, total, counts: urlCounts(site), lastSyncAt: site.lastSyncAt, warnings }
    },
  )

  app.get('/sites/:id/submissions', async (req, reply) => {
    const { id } = req.params as { id: string }
    return db
      .select()
      .from(submissions)
      .where(eq(submissions.siteId, id))
      .orderBy(desc(submissions.createdAt))
      .limit(50)
      .all()
  })

  // --- Settings ---

  app.get('/settings', async () => {
    const row = db.select().from(settings).get()
    return {
      discordConfigured: !!row?.discordWebhookUrl,
      events: row?.events ?? [],
      eventKeys: EVENT_KEYS,
      webhookSecret: row?.webhookSecret ?? null,
      dryRun: DRY_RUN,
      devMode: process.env.NODE_ENV !== 'production',
    }
  })

  app.put(
    '/settings',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            discordWebhookUrl: { type: ['string', 'null'], maxLength: 500 },
            events: { type: 'array', items: { type: 'string', enum: EVENT_KEYS }, maxItems: 20 },
            webhookSecret: { type: ['string', 'null'], maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const body = req.body as { discordWebhookUrl?: string | null; events?: string[]; webhookSecret?: string | null }
      const existing = db.select().from(settings).get()
      const values = {
        discordWebhookUrl:
          body.discordWebhookUrl !== undefined
            ? body.discordWebhookUrl || null
            : (existing?.discordWebhookUrl ?? null),
        events: body.events ?? existing?.events ?? [],
        webhookSecret:
          body.webhookSecret !== undefined
            ? body.webhookSecret || null
            : (existing?.webhookSecret ?? null),
      }
      db.insert(settings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: settings.id, set: values })
        .run()
      return {
        discordConfigured: !!values.discordWebhookUrl,
        events: values.events,
        eventKeys: EVENT_KEYS,
        webhookSecret: values.webhookSecret,
      }
    },
  )

  app.post('/settings/test-notification', async (_req, reply) => {
    const row = db.select().from(settings).get()
    if (!row?.discordWebhookUrl) return reply.code(400).send({ error: 'No Discord webhook configured' })
    try {
      await sendDiscord(row.discordWebhookUrl, 'test', { site: 'Test notification', urlCount: 0, statusCode: 200 })
      return { ok: true }
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Discord notification test failed' })
    }
  })
}

/** Unauthenticated routes: per-site webhook trigger. */
export async function publicRoutes(app: FastifyInstance) {
  app.post(
    '/hook/:siteId',
    {
      schema: {
        body: {
          type: ['object', 'null'],
          properties: {
            urls: { type: 'array', items: { type: 'string', format: 'uri' }, maxItems: 10_000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { siteId } = req.params as { siteId: string }
      const secret = req.headers['x-webhook-secret'] as string | undefined
      if (!secret) {
        return reply.code(401).send({ error: 'Missing X-Webhook-Secret header' })
      }
      // Check against the account-level webhook secret
      const row = db.select().from(settings).get()
      if (!row?.webhookSecret || row.webhookSecret !== secret) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const site = db.select().from(sites).where(eq(sites.id, siteId)).get()
      if (!site) {
        return reply.code(404).send({ error: 'Site not found' })
      }
      if (site.submissionLevel !== 'webhook') {
        return reply.code(400).send({ error: 'Site is not set to webhook submission level' })
      }
      const urls = (req.body as { urls?: string[] } | null)?.urls
      if (urls?.length) {
        const v = validateExplicitUrls(site, urls)
        if (v.invalid.length > 0) {
          return reply.code(400).send({
            error: `Rejected ${v.invalid.length} URL(s) not in sitemap or host mismatch`,
            invalid: v.invalid,
          })
        }
      }
      try {
        return await runSubmission(site, 'webhook', urls)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Rejected')) return reply.code(400).send({ error: msg })
        throw err
      }
    },
  )
}
