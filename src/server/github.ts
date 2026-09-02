import { c } from './auth.ts'
import { appVersion } from './version.ts'

const REPO = 'TheTechBasket/index-now-server'
const CHECK_INTERVAL_MS = 7 * 86_400_000 // weekly, per user request — avoids hammering the GitHub API

export type GithubStats = {
  stars: number
  repoUrl: string
  latestVersion: string | null
  latestUrl: string | null
  latestNotes: string | null
  publishedAt: string | null
  updateAvailable: boolean
  checkedAt: string
}

let cached: GithubStats | null = null
let cachedAt = 0

/** Compares two "x.y.z" strings — true if `latest` is strictly newer than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map(Number)
  const b = current.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

async function fetchGithubStats(): Promise<GithubStats> {
  const now = new Date().toISOString()
  let stars = 0
  let repoUrl = `https://github.com/${REPO}`
  let latestVersion: string | null = null
  let latestUrl: string | null = null
  let latestNotes: string | null = null
  let publishedAt: string | null = null

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as { stargazers_count?: number; html_url?: string }
      stars = data.stargazers_count ?? 0
      repoUrl = data.html_url ?? repoUrl
    }
  } catch (err) {
    console.warn(c.yellow('[github] repo stats fetch failed:'), err instanceof Error ? err.message : err)
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string; html_url?: string; body?: string; published_at?: string }
      latestVersion = data.tag_name?.replace(/^v/, '') ?? null
      latestUrl = data.html_url ?? null
      latestNotes = data.body ?? null
      publishedAt = data.published_at ?? null
    }
  } catch (err) {
    console.warn(c.yellow('[github] latest release fetch failed:'), err instanceof Error ? err.message : err)
  }

  return {
    stars,
    repoUrl,
    latestVersion,
    latestUrl,
    latestNotes,
    publishedAt,
    updateAvailable: latestVersion ? isNewer(latestVersion, appVersion) : false,
    checkedAt: now,
  }
}

/** Cached weekly — call as often as you like, only hits the GitHub API once per interval. */
export async function getGithubStats(): Promise<GithubStats> {
  if (cached && Date.now() - cachedAt < CHECK_INTERVAL_MS) return cached
  const fresh = await fetchGithubStats()
  cached = fresh
  cachedAt = Date.now()
  return fresh
}
