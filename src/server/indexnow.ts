import { and, eq, sql, type SQL } from 'drizzle-orm'
import { XMLParser } from 'fast-xml-parser'
import { c } from './auth.ts'
import { db } from './db/index.ts'
import { sites, siteUrls, submissions } from './db/schema.ts'
import { type EventKey, notify } from './notify.ts'

type Site = typeof sites.$inferSelect
type Trigger = 'manual' | 'scheduled' | 'webhook'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const BATCH_LIMIT = 10_000 // IndexNow max URLs per request
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1_000

const parser = new XMLParser({
  removeNSPrefix: true,
})

export type SitemapEntry = { loc: string; lastmod: string | null }

/**
 * Fetch a sitemap (or sitemap index) and return all page URLs with their lastmod.
 * Also returns the child-sitemap count (meaningful at depth=0 for sitemap indexes).
 */
export async function fetchSitemapEntries(
  sitemapUrl: string,
  depth = 0,
): Promise<{ entries: SitemapEntry[]; sitemapCount: number }> {
  if (depth > 2) return { entries: [], sitemapCount: 0 }
  const res = await fetch(sitemapUrl, {
    headers: { 'user-agent': 'index-now-server' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Sitemap fetch failed (${res.status}): ${sitemapUrl}`)
  const xml = parser.parse(await res.text())

  if (xml.sitemapindex?.sitemap) {
    const childSitemaps = [xml.sitemapindex.sitemap].flat()
    const nested = await Promise.allSettled(
      childSitemaps.map((s: { loc?: unknown }) =>
        s?.loc
          ? fetchSitemapEntries(String(s.loc), depth + 1)
          : Promise.resolve({ entries: [] as SitemapEntry[], sitemapCount: 0 }),
      ),
    )
    return {
      entries: nested.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value.entries),
      sitemapCount: depth === 0 ? childSitemaps.length : 0,
    }
  }

  const urls = xml.urlset?.url ? [xml.urlset.url].flat() : []
  return {
    entries: urls
      .map((u: { loc?: unknown; lastmod?: unknown }) => ({
        loc: String(u?.loc ?? ''),
        lastmod: u?.lastmod ? String(u.lastmod) : null,
      }))
      .filter((e: SitemapEntry) => e.loc.startsWith('http')),
    sitemapCount: 1,
  }
}

/** Check if a site has its IndexNow key deployed at https://host/key.txt */
export async function verifyKeyDeployment(host: string, apiKey: string): Promise<{
  found: boolean
  statusCode: number
  bodyPreview: string
}> {
  const url = `https://${host}/${apiKey}.txt`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const text = await res.text()
    const bodyPreview = text.slice(0, 200).trim()
    // Key is properly deployed if the response body is exactly the key string
    return {
      found: res.ok && bodyPreview === apiKey,
      statusCode: res.status,
      bodyPreview: bodyPreview || '(empty)',
    }
  } catch (err) {
    return {
      found: false,
      statusCode: 0,
      bodyPreview: err instanceof Error ? err.message : 'Connection failed',
    }
  }
}

/** Discover a site's sitemap: robots.txt "Sitemap:" lines, then well-known paths. */
export async function discoverSitemaps(websiteUrl: string): Promise<{ host: string; sitemapUrls: string[] }> {
  const origin = new URL(/^https?:\/\//.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`)
  const fetchOpts = {
    headers: { 'user-agent': 'index-now-server' },
    signal: AbortSignal.timeout(10_000),
  }

  const found: string[] = []
  try {
    const res = await fetch(`${origin.origin}/robots.txt`, fetchOpts)
    if (res.ok) {
      for (const match of (await res.text()).matchAll(/^sitemap:\s*(\S+)/gim)) {
        try {
          found.push(new URL(match[1], origin.origin).href)
        } catch {}
      }
    }
  } catch {}

  if (found.length === 0) {
    for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap-0.xml']) {
      try {
        const res = await fetch(origin.origin + path, fetchOpts)
        if (res.ok && (await res.text()).includes('<')) {
          found.push(origin.origin + path)
        }
      } catch {}
    }
  }

  return { host: origin.host, sitemapUrls: [...new Set(found)] }
}

// --- URL status model ---
// new       never submitted
// removed   was in the sitemap once, missing from the latest sync
// updated   submitted before, but sitemap lastmod changed since
// submitted sent and unchanged
// Pending (what a submit run sends) = new + updated.

export const URL_STATUSES = ['new', 'updated', 'submitted', 'removed'] as const
export type UrlStatus = (typeof URL_STATUSES)[number]

/** SQL CASE expression deriving a row's status for a given site. */
export function statusExpr(site: Site): SQL<UrlStatus> {
  const lastSync = site.lastSyncAt ? Math.floor(site.lastSyncAt.getTime() / 1000) : 0
  return sql`CASE
    WHEN ${siteUrls.lastSeenAt} IS NOT NULL AND ${siteUrls.lastSeenAt} < ${lastSync} THEN 'removed'
    WHEN ${siteUrls.submittedAt} IS NULL THEN 'new'
    WHEN ${siteUrls.lastmod} IS NOT NULL AND (${siteUrls.submittedLastmod} IS NULL OR ${siteUrls.submittedLastmod} != ${siteUrls.lastmod}) THEN 'updated'
    ELSE 'submitted'
  END` as SQL<UrlStatus>
}

export function urlCounts(site: Site): Record<UrlStatus | 'total' | 'pending', number> {
  const rows = db
    .select({ status: statusExpr(site), n: sql<number>`count(*)` })
    .from(siteUrls)
    .where(eq(siteUrls.siteId, site.id))
    .groupBy(sql`1`)
    .all()
  const counts = { new: 0, updated: 0, submitted: 0, removed: 0, total: 0, pending: 0 }
  for (const r of rows) {
    counts[r.status] = r.n
    counts.total += r.n
  }
  counts.pending = counts.new + counts.updated
  return counts
}

/** Fetch the sitemap and refresh URL rows — no submission. Returns fresh counts and sitemap count. */
export async function syncSitemap(site: Site): Promise<ReturnType<typeof urlCounts> & { sitemapCount: number }> {
  const { entries, sitemapCount } = await fetchSitemapEntries(site.sitemapUrl)
  const now = new Date()
  const dedup = new Map(entries.map((e) => [e.loc, e.lastmod]))
  db.transaction((tx) => {
    for (const [url, lastmod] of dedup) {
      tx.insert(siteUrls)
        .values({ siteId: site.id, url, lastmod, firstSeenAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [siteUrls.siteId, siteUrls.url],
          set: { lastSeenAt: now, lastmod },
        })
        .run()
    }
    tx.update(sites).set({ lastSyncAt: now, sitemapCount }).where(eq(sites.id, site.id)).run()
  })
  const fresh = { ...site, lastSyncAt: now, sitemapCount }
  return { ...urlCounts(fresh), sitemapCount }
}

/**
 * Submit one batch to api.indexnow.org with retry + exponential backoff.
 * Respects Retry-After headers when present.
 * Returns HTTP status (200/202 = accepted).
 */
async function submitBatch(site: Site, urlList: string[]): Promise<number> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: site.host, key: site.apiKey, urlList }),
        signal: AbortSignal.timeout(30_000),
      })

      // Success — accept 200 or 202
      if (res.ok || res.status === 202) return res.status

      // Rate limited or server error — retry with backoff
      if (res.status === 429 || res.status >= 500) {
        // Parse Retry-After header (seconds or HTTP-date)
        const retryAfter = res.headers.get('retry-after')
        let waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10)
          if (!isNaN(parsed)) {
            waitMs = Math.min(parsed * 1000, 60_000) // cap at 60s
          }
        }
        lastError = new Error(`IndexNow responded ${res.status}, retry after ${waitMs}ms`)
        if (attempt < MAX_RETRIES) {
          console.warn(c.yellow(`[submitBatch] ${lastError.message} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`))
          await new Promise((r) => setTimeout(r, waitMs))
          continue
        }
      }

      // Non-retryable status
      throw new Error(`IndexNow responded ${res.status}`)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('IndexNow responded')) throw err
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES) {
        const waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500
        console.warn(c.yellow(`[submitBatch] Network error: ${lastError.message} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`))
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }

  throw lastError ?? new Error('Submission failed after retries')
}

const eventPrefix: Record<Trigger, string> = { manual: 'manual', scheduled: 'schedule', webhook: 'webhook' }

export type RunResult = { status: 'success' | 'no_changes' | 'error'; urlCount: number; detail?: string }

/**
 * Run a submission: sync the sitemap, then submit pending URLs (new + updated).
 * Webhook calls may pass explicit URLs, which are submitted as-is.
 */
export async function runSubmission(site: Site, trigger: Trigger, explicitUrls?: string[]): Promise<RunResult> {
  const prefix = eventPrefix[trigger]
  try {
    let pending: { url: string; lastmod: string | null }[]
    if (explicitUrls?.length) {
      pending = [...new Set(explicitUrls)].map((url) => ({ url, lastmod: null }))
    } else {
      await syncSitemap(site)
      const fresh = db.select().from(sites).where(eq(sites.id, site.id)).get() ?? site
      pending = db
        .select({ url: siteUrls.url, lastmod: siteUrls.lastmod })
        .from(siteUrls)
        .where(and(eq(siteUrls.siteId, site.id), sql`${statusExpr(fresh)} IN ('new', 'updated')`))
        .all()
    }

    if (pending.length === 0) {
      db.insert(submissions).values({ siteId: site.id, trigger, urlCount: 0, status: 'no_changes' }).run()
      if (trigger === 'scheduled') await notify('schedule.no_changes', { site: site.name, urlCount: 0 })
      return { status: 'no_changes', urlCount: 0 }
    }

    const now = new Date()
    let lastStatus = 0
    for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
      const batch = pending.slice(i, i + BATCH_LIMIT)
      lastStatus = await submitBatch(site, batch.map((p) => p.url))
      db.transaction((tx) => {
        for (const { url, lastmod } of batch) {
          tx.insert(siteUrls)
            .values({ siteId: site.id, url, lastmod, submittedAt: now, submittedLastmod: lastmod, statusCode: lastStatus })
            .onConflictDoUpdate({
              target: [siteUrls.siteId, siteUrls.url],
              set: { submittedAt: now, submittedLastmod: sql`${siteUrls.lastmod}`, statusCode: lastStatus },
            })
            .run()
        }
      })
    }

    db.insert(submissions)
      .values({ siteId: site.id, trigger, urlCount: pending.length, status: 'success', detail: `HTTP ${lastStatus}` })
      .run()
    if (trigger !== 'webhook') {
      await notify(`${prefix}.success` as EventKey, {
        site: site.name,
        urlCount: pending.length,
        statusCode: lastStatus,
      })
    }
    return { status: 'success', urlCount: pending.length, detail: `HTTP ${lastStatus}` }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    db.insert(submissions).values({ siteId: site.id, trigger, urlCount: 0, status: 'error', detail }).run()
    await notify(`${prefix}.error` as EventKey, { site: site.name, error: detail })
    return { status: 'error', urlCount: 0, detail }
  }
}

/** Get submission stats grouped by day for the last N days. */
export function submissionStats(days = 30) {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const cutoffUnix = Math.floor(cutoff.getTime() / 1000)
  const rows = db
    .select({
      date: sql<string>`date(${submissions.createdAt}, 'unixepoch')`,
      status: submissions.status,
      urlCount: sql<number>`sum(${submissions.urlCount})`,
      count: sql<number>`count(*)`,
    })
    .from(submissions)
    .where(sql`${submissions.createdAt} >= ${cutoffUnix}`)
    .groupBy(sql`1, 2`)
    .orderBy(sql`1`)
    .all()
  return rows
}
