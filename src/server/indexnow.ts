import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { XMLParser } from 'fast-xml-parser'
import { c } from './auth.ts'
import { checkpoint, db } from './db/index.ts'
import { sites, siteUrls, submissions } from './db/schema.ts'
import { type EventKey, notify } from './notify.ts'

type Site = typeof sites.$inferSelect
type Trigger = 'manual' | 'scheduled' | 'webhook'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const BATCH_LIMIT = 10_000 // IndexNow max URLs per request
const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1_000

// Dry-run: sitemap sync still hits the real site (read-only, safe), but the actual
// IndexNow submission POST — the one thing that pushes data to a real external
// service on the site's behalf — is skipped and simulated instead. For local dev
// against real site configs without notifying search engines for real.
export const DRY_RUN = process.env.DRY_RUN === 'true'
if (DRY_RUN) console.warn(c.yellow('[indexnow] DRY_RUN=true — IndexNow submissions are simulated, nothing is sent to api.indexnow.org'))

// Sitemap fetch tuning — env overridable, sequential gap prevents thundering herd
const SITEMAP_MAX_RETRIES = Number(process.env.SITEMAP_MAX_RETRIES ?? 3)
const SITEMAP_BASE_BACKOFF_MS = Number(process.env.SITEMAP_BASE_BACKOFF_MS ?? 1_500)
const SITEMAP_CHILD_CONCURRENCY = Number(process.env.SITEMAP_CHILD_CONCURRENCY ?? 3)
const SITEMAP_CHILD_GAP_MS = Number(process.env.SITEMAP_CHILD_GAP_MS ?? 400)

const parser = new XMLParser({
  removeNSPrefix: true,
})

export type SitemapEntry = { loc: string; lastmod: string | null; path: string[] }
export type SitemapNode = { url: string; count: number; children?: SitemapNode[] }

export class SitemapFetchError extends Error {
  statusCode: number
  suggestedSitemap?: string
  finalUrl?: string
  constructor(message: string, statusCode: number, opts?: { suggestedSitemap?: string; finalUrl?: string }) {
    super(message)
    this.statusCode = statusCode
    this.suggestedSitemap = opts?.suggestedSitemap
    this.finalUrl = opts?.finalUrl
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Rows-per-statement for bulk upserts — one multi-row INSERT..ON CONFLICT per chunk
// instead of one statement per row (large sites were doing 100k+ individual statements
// per sync). Kept well under SQLite's default bound-parameter limit (999).
const BULK_CHUNK = 100

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function parseRetryAfterMs(header: string | null, fallbackMs: number): number {
  if (!header) return fallbackMs
  const secs = parseInt(header, 10)
  if (!Number.isNaN(secs)) return Math.min(secs * 1_000, 60_000)
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000)
  return fallbackMs
}

async function fetchSitemapOnce(sitemapUrl: string): Promise<Response> {
  return fetch(sitemapUrl, {
    headers: { 'user-agent': 'index-now-server' },
    signal: AbortSignal.timeout(30_000),
  })
}

async function fetchSitemapWithRetry(sitemapUrl: string): Promise<Response> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= SITEMAP_MAX_RETRIES; attempt++) {
    try {
      const res = await fetchSitemapOnce(sitemapUrl)
      if (res.ok) return res
      // 429/5xx/403 are retryable for sitemaps (WAF/bot protection often returns 403 transiently)
      const retryable = res.status === 403 || res.status === 429 || res.status >= 500
      if (!retryable) {
        throw new SitemapFetchError(`Sitemap fetch failed (${res.status}): ${sitemapUrl}`, res.status)
      }
      const retryAfter = res.headers.get('retry-after')
      const base = res.status === 403 ? SITEMAP_BASE_BACKOFF_MS * 2 : SITEMAP_BASE_BACKOFF_MS
      const waitMs = parseRetryAfterMs(retryAfter, base * Math.pow(2, attempt) + Math.random() * 500)
      lastErr = new SitemapFetchError(`Sitemap fetch failed (${res.status}): ${sitemapUrl}`, res.status)
      if (attempt < SITEMAP_MAX_RETRIES) {
        console.warn(c.yellow(`[sitemap] ${res.status} for ${sitemapUrl} — retry ${attempt + 1}/${SITEMAP_MAX_RETRIES + 1} after ${waitMs}ms`))
        await sleep(waitMs)
        continue
      }
      throw lastErr
    } catch (err) {
      if (err instanceof SitemapFetchError) throw err
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt < SITEMAP_MAX_RETRIES) {
        const waitMs = SITEMAP_BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500
        console.warn(c.yellow(`[sitemap] network error for ${sitemapUrl}: ${lastErr.message} — retry ${attempt + 1}/${SITEMAP_MAX_RETRIES + 1} after ${waitMs}ms`))
        await sleep(waitMs)
        continue
      }
      throw new SitemapFetchError(lastErr.message, 0)
    }
  }
  throw lastErr ?? new SitemapFetchError(`Sitemap fetch failed: ${sitemapUrl}`, 0)
}

/**
 * Fetch a sitemap (or sitemap index) and return all page URLs with their lastmod.
 * Also returns the child-sitemap count (meaningful at depth=0 for sitemap indexes).
 * Tracks redirect: res.redirected / res.url vs sitemapUrl.
 */
export async function fetchSitemapEntries(
  sitemapUrl: string,
  depth = 0,
  path: string[] = [],
): Promise<{ entries: SitemapEntry[]; sitemapCount: number; tree?: SitemapNode[]; finalUrl?: string; redirected?: boolean }> {
  if (depth > 2) return { entries: [], sitemapCount: 0 }
  const res = await fetchSitemapWithRetry(sitemapUrl)
  const finalUrl = res.url ?? sitemapUrl
  const redirected = Boolean(res.redirected && finalUrl !== sitemapUrl)
  const xml = parser.parse(await res.text())

  if (xml.sitemapindex?.sitemap) {
    const childSitemaps = [xml.sitemapindex.sitemap].flat()
    // Throttled child fetch: concurrency + gap avoids burst 403 on large indexes
    const results: { url: string; entries: SitemapEntry[]; tree?: SitemapNode[] }[] = []
    let idx = 0
    async function worker() {
      while (idx < childSitemaps.length) {
        const cur = idx++
        const s = childSitemaps[cur] as { loc?: unknown }
        if (!s?.loc) continue
        const childUrl = String(s.loc)
        try {
          const r = await fetchSitemapEntries(childUrl, depth + 1, [...path, childUrl])
          results.push({ url: childUrl, entries: r.entries, tree: r.tree })
        } catch (err) {
          console.warn(c.yellow(`[sitemap] child fetch failed ${childUrl}: ${err instanceof Error ? err.message : String(err)}`))
        }
        if (cur < childSitemaps.length - 1 && SITEMAP_CHILD_GAP_MS > 0) await sleep(SITEMAP_CHILD_GAP_MS)
      }
    }
    const workers = Array.from({ length: Math.min(SITEMAP_CHILD_CONCURRENCY, childSitemaps.length) }, () => worker())
    await Promise.all(workers)
    return {
      entries: results.flatMap((r) => r.entries),
      sitemapCount: depth === 0 ? childSitemaps.length : 0,
      tree: results.map((r) => ({ url: r.url, count: r.entries.length, children: r.tree })),
      finalUrl,
      redirected,
    }
  }

  const urls = xml.urlset?.url ? [xml.urlset.url].flat() : []
  return {
    entries: urls
      .map((u: { loc?: unknown; lastmod?: unknown }) => ({
        loc: String(u?.loc ?? ''),
        lastmod: u?.lastmod ? String(u.lastmod) : null,
        path,
      }))
      .filter((e: SitemapEntry) => e.loc.startsWith('http')),
    sitemapCount: 1,
    finalUrl,
    redirected,
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

type UrlCounts = Record<UrlStatus | 'total' | 'pending', number>

const EMPTY_COUNTS: UrlCounts = { new: 0, updated: 0, submitted: 0, removed: 0, total: 0, pending: 0 }

/** Batched form of urlCounts() — one grouped query for all sites instead of one
 * query per site (dashboard load was doing 2N+1 queries for N sites). */
export function urlCountsForSites(siteIds: string[]): Map<string, UrlCounts> {
  const result = new Map<string, UrlCounts>()
  if (siteIds.length === 0) return result

  const statusExprJoined = sql`CASE
    WHEN ${siteUrls.lastSeenAt} IS NOT NULL AND ${siteUrls.lastSeenAt} < ${sites.lastSyncAt} THEN 'removed'
    WHEN ${siteUrls.submittedAt} IS NULL THEN 'new'
    WHEN ${siteUrls.lastmod} IS NOT NULL AND (${siteUrls.submittedLastmod} IS NULL OR ${siteUrls.submittedLastmod} != ${siteUrls.lastmod}) THEN 'updated'
    ELSE 'submitted'
  END` as SQL<UrlStatus>

  const rows = db
    .select({ siteId: siteUrls.siteId, status: statusExprJoined, n: sql<number>`count(*)` })
    .from(siteUrls)
    .innerJoin(sites, eq(sites.id, siteUrls.siteId))
    .where(inArray(siteUrls.siteId, siteIds))
    .groupBy(siteUrls.siteId, sql`2`)
    .all()

  for (const r of rows) {
    const counts = result.get(r.siteId) ?? { ...EMPTY_COUNTS }
    counts[r.status] = r.n
    counts.total += r.n
    counts.pending = counts.new + counts.updated
    result.set(r.siteId, counts)
  }
  return result
}

/** Batched "last submission per site" — one query for max id per site, one for
 * the rows, instead of one query per site. */
export function latestSubmissionsForSites(siteIds: string[]): Map<string, typeof submissions.$inferSelect> {
  const result = new Map<string, typeof submissions.$inferSelect>()
  if (siteIds.length === 0) return result

  const maxIds = db
    .select({ siteId: submissions.siteId, maxId: sql<number>`max(${submissions.id})` })
    .from(submissions)
    .where(inArray(submissions.siteId, siteIds))
    .groupBy(submissions.siteId)
    .all()
  if (maxIds.length === 0) return result

  const rows = db
    .select()
    .from(submissions)
    .where(inArray(submissions.id, maxIds.map((m) => m.maxId)))
    .all()
  for (const r of rows) result.set(r.siteId, r)
  return result
}

// --- Host mismatch / sitemap guard helpers ---

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase())
}

export function isUrlHostMismatch(url: string, siteHost: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (isLocalHost(host)) return true
    return host.toLowerCase() !== siteHost.toLowerCase()
  } catch {
    return true
  }
}

export type SitemapWarnings = {
  mismatchedCount: number
  localCount: number
  samples: string[]
}

export function getSitemapWarnings(site: Site): SitemapWarnings {
  const rows = db.select({ url: siteUrls.url }).from(siteUrls).where(eq(siteUrls.siteId, site.id)).all()
  let mismatchedCount = 0
  let localCount = 0
  const samples: string[] = []
  for (const r of rows) {
    try {
      const host = new URL(r.url).hostname.toLowerCase()
      if (isLocalHost(host)) {
        localCount++
        mismatchedCount++
        if (samples.length < 5) samples.push(r.url)
      } else if (host !== site.host.toLowerCase()) {
        mismatchedCount++
        if (samples.length < 5) samples.push(r.url)
      }
    } catch {
      mismatchedCount++
      if (samples.length < 5) samples.push(r.url)
    }
  }
  return { mismatchedCount, localCount, samples }
}

/** Cheap approximate mismatch count for all sites at once, for the dashboard badge.
 * SQL prefix match instead of getSitemapWarnings' exact per-row `new URL()` parse -
 * that's fine for one site's detail page but doing it for every site on every
 * dashboard load would mean parsing every URL in the database on every load. This
 * trades exactness (misses odd edge cases the real URL parser would catch) for one
 * indexed-ish table scan; the detail page still shows the precise count + samples. */
export function mismatchCountsForSites(siteIds: string[]): Map<string, number> {
  const result = new Map<string, number>()
  if (siteIds.length === 0) return result
  const rows = db
    .select({ siteId: siteUrls.siteId, n: sql<number>`count(*)` })
    .from(siteUrls)
    .innerJoin(sites, eq(sites.id, siteUrls.siteId))
    .where(
      and(
        inArray(siteUrls.siteId, siteIds),
        sql`${siteUrls.url} NOT LIKE ('http://' || ${sites.host} || '/%')
          AND ${siteUrls.url} NOT LIKE ('https://' || ${sites.host} || '/%')
          AND ${siteUrls.url} != ('http://' || ${sites.host})
          AND ${siteUrls.url} != ('https://' || ${sites.host})`,
      ),
    )
    .groupBy(siteUrls.siteId)
    .all()
  for (const r of rows) result.set(r.siteId, r.n)
  return result
}

export function validateExplicitUrls(site: Site, urls: string[]): { valid: string[]; invalid: { url: string; reason: string }[] } {
  const valid: string[] = []
  const invalid: { url: string; reason: string }[] = []
  const existing = new Set(
    db.select({ url: siteUrls.url }).from(siteUrls).where(eq(siteUrls.siteId, site.id)).all().map((r) => r.url),
  )
  for (const raw of urls) {
    const url = raw.trim()
    if (!url) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      invalid.push({ url, reason: 'invalid_url' })
      continue
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      invalid.push({ url, reason: 'invalid_url' })
      continue
    }
    if (isUrlHostMismatch(url, site.host)) {
      invalid.push({ url, reason: 'host_mismatch' })
      continue
    }
    if (!existing.has(url)) {
      invalid.push({ url, reason: 'not_in_sitemap' })
      continue
    }
    valid.push(url)
  }
  return { valid, invalid }
}

// --- Bulk URL management ---

export function resetUrlStatuses(siteId: string): number {
  const res = db
    .update(siteUrls)
    .set({ submittedAt: null, submittedLastmod: null, statusCode: null })
    .where(eq(siteUrls.siteId, siteId))
    .run()
  return res.changes
}

export function deleteAllUrls(siteId: string): number {
  const res = db.delete(siteUrls).where(eq(siteUrls.siteId, siteId)).run()
  return res.changes
}

export function pruneRemovedUrls(site: Site): number {
  const expr = statusExpr(site)
  // delete where derived status = 'removed'
  const res = db
    .delete(siteUrls)
    .where(and(eq(siteUrls.siteId, site.id), sql`${expr} = 'removed'`))
    .run()
  return res.changes
}

export function deleteUrlsByIds(siteId: string, ids: number[]): number {
  if (ids.length === 0) return 0
  return db.transaction((tx) => {
    let total = 0
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      const res = tx
        .delete(siteUrls)
        .where(and(eq(siteUrls.siteId, siteId), inArray(siteUrls.id, chunk)))
        .run()
      total += res.changes
    }
    return total
  })
}

async function suggestSitemapForSite(site: Site): Promise<string | undefined> {
  try {
    const discovered = await discoverSitemaps(`https://${site.host}`)
    // prefer first discovered that differs from current
    const alt = discovered.sitemapUrls.find((u) => u !== site.sitemapUrl)
    return alt ?? discovered.sitemapUrls[0]
  } catch {
    return undefined
  }
}

/** Fetch the sitemap and refresh URL rows — no submission. Returns fresh counts and sitemap count. */
export async function syncSitemap(
  site: Site,
): Promise<ReturnType<typeof urlCounts> & { sitemapCount: number; redirected?: boolean; finalUrl?: string }> {
  let entries: SitemapEntry[]
  let sitemapCount: number
  let tree: SitemapNode[] | undefined
  let finalUrl: string | undefined
  let redirected: boolean | undefined
  try {
    const result = await fetchSitemapEntries(site.sitemapUrl)
    entries = result.entries
    sitemapCount = result.sitemapCount
    tree = result.tree
    finalUrl = result.finalUrl
    redirected = result.redirected
  } catch (err) {
    const isFetchError = err instanceof SitemapFetchError
    const statusCode = isFetchError ? err.statusCode : 0
    const msg = err instanceof Error ? err.message : String(err)

    // On 404, try to discover new sitemap via robots.txt
    if (statusCode === 404) {
      const suggested = await suggestSitemapForSite(site)
      const detail = suggested && suggested !== site.sitemapUrl
        ? `Sitemap 404 at ${site.sitemapUrl}. Found alternative in robots.txt: ${suggested}. Your sitemap URL may have changed.`
        : `Sitemap 404 at ${site.sitemapUrl}. No alternative found in robots.txt. Check your sitemap URL.`
      await notify('sitemap.not_found', { site: site.name, error: detail, statusCode })
      throw new SitemapFetchError(detail, 404, { suggestedSitemap: suggested })
    }

    // Other fetch errors (500, network, timeout)
    const detail = `Sitemap sync failed for ${site.name}: ${msg}`
    await notify('sitemap.fetch_error', { site: site.name, error: detail, statusCode })
    if (isFetchError) throw err
    throw new SitemapFetchError(detail, statusCode || 0)
  }

  // Notify on redirect even though sync proceeds
  if (redirected && finalUrl && finalUrl !== site.sitemapUrl) {
    const detail = `Sitemap redirected from ${site.sitemapUrl} to ${finalUrl}. Consider updating your sitemap URL.`
    await notify('sitemap.redirect', { site: site.name, error: detail, statusCode: 301 })
    console.warn(c.yellow(`[sitemap] ${detail}`))
  }

  const excluded = new Set(site.excludedSitemaps ?? [])
  const inScope = excluded.size > 0 ? entries.filter((e) => !e.path.some((p) => excluded.has(p))) : entries
  const now = new Date()
  const dedup = new Map(inScope.map((e) => [e.loc, e.lastmod]))
  const rows = [...dedup].map(([url, lastmod]) => ({ siteId: site.id, url, lastmod, firstSeenAt: now, lastSeenAt: now }))
  db.transaction((tx) => {
    for (const batch of chunk(rows, BULK_CHUNK)) {
      tx.insert(siteUrls)
        .values(batch)
        .onConflictDoUpdate({
          target: [siteUrls.siteId, siteUrls.url],
          set: { lastSeenAt: now, lastmod: sql`excluded.lastmod` },
        })
        .run()
    }
    tx.update(sites).set({ lastSyncAt: now, sitemapCount, sitemapChildren: tree ?? null }).where(eq(sites.id, site.id)).run()
  })
  checkpoint()
  const fresh = { ...site, lastSyncAt: now, sitemapCount }
  return { ...urlCounts(fresh), sitemapCount, redirected, finalUrl }
}

// Status codes IndexNow can return where a transient cause (WAF hiccup, propagation delay,
// brief outage) is plausible enough to retry. 400/422 (bad request / URL-host mismatch) are
// not here — retrying the same malformed request never helps.
const RETRYABLE_STATUSES = new Set([403, 404, 429])

function submitStatusDetail(status: number, host: string, apiKey: string): string {
  if (status === 403) return `IndexNow rejected the key (403) — check the key file is deployed at https://${host}/${apiKey}.txt`
  if (status === 404) return 'IndexNow endpoint not found (404) — check network/DNS to api.indexnow.org'
  if (status === 429) return 'Rate limited by IndexNow (429) — retries exhausted'
  if (status >= 500) return `IndexNow server error (${status}) — retries exhausted`
  return `IndexNow responded ${status}`
}

/**
 * Submit one batch to api.indexnow.org with retry + exponential backoff.
 * Respects Retry-After headers when present. 403/404/429/5xx are all retried (each can be
 * transient — a WAF hiccup, propagation delay after deploying the key, a brief outage) before
 * giving up with a status-specific, actionable error.
 * Returns HTTP status (200/202 = accepted).
 */
async function submitBatch(site: Site, urlList: string[]): Promise<number> {
  if (DRY_RUN) {
    console.log(c.cyan(`[dry-run] Would submit ${urlList.length} URL(s) for ${site.name} to IndexNow — skipped`))
    return 202
  }

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

      if (RETRYABLE_STATUSES.has(res.status) || res.status >= 500) {
        // Parse Retry-After header (seconds or HTTP-date)
        const retryAfter = res.headers.get('retry-after')
        let waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10)
          if (!isNaN(parsed)) {
            waitMs = Math.min(parsed * 1000, 60_000) // cap at 60s
          }
        }
        lastError = new Error(submitStatusDetail(res.status, site.host, site.apiKey))
        if (attempt < MAX_RETRIES) {
          console.warn(c.yellow(`[submitBatch] HTTP ${res.status} for ${site.name}, retry ${attempt + 1}/${MAX_RETRIES + 1} after ${waitMs}ms`))
          await new Promise((r) => setTimeout(r, waitMs))
          continue
        }
        throw lastError
      }

      // Non-retryable status (400 bad request, 422 URL/host mismatch, ...)
      lastError = new Error(submitStatusDetail(res.status, site.host, site.apiKey))
      throw lastError
    } catch (err) {
      if (err === lastError) throw err
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
export async function runSubmission(
  site: Site,
  trigger: Trigger,
  explicitUrls?: string[],
  onBatch?: (batchIndex: number, batchTotal: number) => void,
): Promise<RunResult> {
  const prefix = eventPrefix[trigger]
  try {
    let pending: { url: string; lastmod: string | null }[]
    if (explicitUrls?.length) {
      const deduped = [...new Set(explicitUrls.map((u) => u.trim()).filter(Boolean))]
      const v = validateExplicitUrls(site, deduped)
      if (v.invalid.length > 0) {
        const detail = `Rejected ${v.invalid.length} URL(s) not in sitemap or host mismatch: ${v.invalid.map((i) => `${i.url} (${i.reason})`).join(', ')}`
        throw new Error(detail)
      }
      pending = v.valid.map((url) => ({ url, lastmod: null }))
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
    const batchTotal = Math.ceil(pending.length / BATCH_LIMIT)
    for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
      onBatch?.(i / BATCH_LIMIT + 1, batchTotal)
      const batch = pending.slice(i, i + BATCH_LIMIT)
      lastStatus = await submitBatch(site, batch.map((p) => p.url))
      db.transaction((tx) => {
        for (const rows of chunk(batch, BULK_CHUNK)) {
          tx.insert(siteUrls)
            .values(rows.map(({ url, lastmod }) => ({ siteId: site.id, url, lastmod, submittedAt: now, submittedLastmod: lastmod, statusCode: lastStatus })))
            .onConflictDoUpdate({
              target: [siteUrls.siteId, siteUrls.url],
              set: { submittedAt: now, submittedLastmod: sql`${siteUrls.lastmod}`, statusCode: lastStatus },
            })
            .run()
        }
      })
    }

    const detail = DRY_RUN ? `DRY RUN: HTTP ${lastStatus} (simulated)` : `HTTP ${lastStatus}`
    db.insert(submissions)
      .values({ siteId: site.id, trigger, urlCount: pending.length, status: 'success', detail })
      .run()
    if (trigger !== 'webhook' && !DRY_RUN) {
      await notify(`${prefix}.success` as EventKey, {
        site: site.name,
        urlCount: pending.length,
        statusCode: lastStatus,
      })
    }
    return { status: 'success', urlCount: pending.length, detail }
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
