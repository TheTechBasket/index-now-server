export type Site = {
  id: string
  name: string
  host: string
  sitemapUrl: string
  apiKey: string
  submissionLevel: 'manual' | 'scheduled' | 'webhook'
  cronInterval: 'hourly' | '6h' | 'daily' | 'weekly' | 'monthly'
  webhookSecret: string
  sitemapCount: number | null
  keyVerified: boolean | null
  keyVerifiedAt: string | null
  lastSyncAt: string | null
  createdAt: number
  lastSubmission: Submission | null
  urlCounts: UrlCounts
}

export type UrlStatus = 'new' | 'updated' | 'submitted' | 'removed'
export type UrlCounts = Record<UrlStatus | 'total' | 'pending', number>

export type SiteUrl = {
  id: number
  url: string
  lastmod: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
  submittedAt: string | null
  statusCode: number | null
  status: UrlStatus
}

export type Submission = {
  id: number
  siteId: string
  trigger: 'manual' | 'scheduled' | 'webhook'
  urlCount: number
  status: 'success' | 'no_changes' | 'error'
  detail: string | null
  createdAt: number
}

export type KeyVerifyResult = {
  found: boolean
  statusCode: number
  bodyPreview: string
  keyUrl: string
}

export type SitemapWarnings = { mismatchedCount: number; localCount: number; samples: string[] }

export type SitemapSyncResult = UrlCounts & {
  sitemapCount: number
  redirected?: boolean
  finalUrl?: string
}

export type SyncError = { error: string; statusCode?: number; suggestedSitemap?: string; finalUrl?: string }

export type Settings = {
  discordConfigured: boolean
  events: string[]
  eventKeys: string[]
  webhookSecret: string | null
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string; message?: string; suggestedSitemap?: string; finalUrl?: string; statusCode?: number } | null
    const err = new Error(body?.error ?? body?.message ?? `Request failed (${res.status})`) as Error & { suggestedSitemap?: string; finalUrl?: string; statusCode?: number }
    if (body?.suggestedSitemap) err.suggestedSitemap = body.suggestedSitemap
    if (body?.finalUrl) err.finalUrl = body.finalUrl
    if (body?.statusCode) err.statusCode = body.statusCode
    throw err
  }
  return res.json() as Promise<T>
}
