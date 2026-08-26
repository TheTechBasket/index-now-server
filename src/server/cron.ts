import cron from 'node-cron'
import { and, eq } from 'drizzle-orm'
import { c } from './auth.ts'
import { db } from './db/index.ts'
import { sites } from './db/schema.ts'
import { runSubmission } from './indexnow.ts'

const SCHEDULES = {
  hourly: '0 * * * *',
  '6h': '0 */6 * * *',
  daily: '0 3 * * *', // 3am — off-peak
  weekly: '0 3 * * 0', // 3am Sunday
  monthly: '0 3 1 * *', // 3am 1st of month
} as const

// Tunable gaps — prevents burst 403 / IndexNow rate-limit when many sites share a tick
const INTER_SITE_DELAY_MS = Number(process.env.CRON_INTER_SITE_DELAY_MS ?? 2_000)
const JITTER_MAX_MS = Number(process.env.CRON_JITTER_MAX_MS ?? 5_000)
const BACKOFF_403_MS = Number(process.env.CRON_BACKOFF_403_MS ?? 10_000)

// Global guard so hourly vs daily ticks never overlap
let running: string | null = null

function hashJitter(id: string, max: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return max ? h % max : 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function startCron() {
  for (const [interval, expr] of Object.entries(SCHEDULES) as [keyof typeof SCHEDULES, string][]) {
    cron.schedule(expr, () => {
      if (running) {
        console.warn(c.yellow(`[cron] Skipping ${interval} tick - ${running} still in progress`))
        return
      }
      running = interval
      runScheduledForInterval(interval)
        .catch((err) => console.error(c.red(`[cron] ${interval} run failed:`), err))
        .finally(() => { running = null })
    })
  }
}

/**
 * Run all scheduled sites for an interval — strictly sequential, never parallel.
 * Each site sleeps `INTER_SITE_DELAY_MS + jitter + penalty` so N sites spread over minutes,
 * not milliseconds. A 403/429 on one site adds penalty before next site to respect WAF/rate-limit.
 */
async function runScheduledForInterval(interval: keyof typeof SCHEDULES) {
  const due = db
    .select()
    .from(sites)
    .where(and(eq(sites.submissionLevel, 'scheduled'), eq(sites.cronInterval, interval)))
    .all()

  if (due.length === 0) return

  // Deterministic order + per-site jitter spreads load across window
  const sorted = [...due].sort((a, b) => a.id.localeCompare(b.id))

  console.log(`[cron] Processing ${sorted.length} sites for interval "${interval}" (gap ${INTER_SITE_DELAY_MS}ms + jitter ≤${JITTER_MAX_MS}ms)`)

  let penaltyMs = 0

  for (let i = 0; i < sorted.length; i++) {
    const site = sorted[i]
    const jitter = hashJitter(site.id, JITTER_MAX_MS)
    if (i > 0) {
      const gap = INTER_SITE_DELAY_MS + jitter + penaltyMs
      await sleep(gap)
    } else if (jitter) {
      // stagger first site too so all intervals don't start at exact 00s
      await sleep(jitter)
    }

    console.log(`[cron] Submitting ${site.name}...`)
    try {
      const result = await runSubmission(site, 'scheduled')
      console.log(`[cron] ${site.name}: ${result.status} (${result.urlCount} URLs)`)
      // decay penalty on success
      if (penaltyMs > 0) penaltyMs = Math.max(0, penaltyMs - 1_000)
      // if detail hints 403/429, still add penalty even on scheduled error object
      if (result.status === 'error' && /\(403\)|\(429\)|429|403/.test(result.detail ?? '')) {
        penaltyMs = BACKOFF_403_MS
        console.warn(c.yellow(`[cron] Rate-limited hint for ${site.name} — adding ${penaltyMs}ms penalty before next site`))
      }
    } catch (err) {
      // runSubmission catches internally and returns {status:'error'} — this only fires on
      // truly unexpected crashes (e.g. a throw outside runSubmission's try/catch).
      console.error(c.red(`[cron] Failed to submit ${site.name}:`), err)
      const msg = err instanceof Error ? err.message : String(err)
      if (/403|429/.test(msg)) {
        penaltyMs = BACKOFF_403_MS
        console.warn(c.yellow(`[cron] Backing off ${penaltyMs}ms before next site (rate limit)`))
      }
    }
  }

  console.log(`[cron] Done processing interval "${interval}"`)
}
