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

// Simple in-process queue to prevent overlapping runs
let running = false

export function startCron() {
  for (const [interval, expr] of Object.entries(SCHEDULES) as [keyof typeof SCHEDULES, string][]) {
    cron.schedule(expr, () => {
      if (running) {
        console.warn(c.yellow(`[cron] Skipping ${interval} tick - previous run still in progress`))
        return
      }
      running = true
      runScheduledForInterval(interval)
        .catch((err) => console.error(c.red(`[cron] ${interval} run failed:`), err))
        .finally(() => { running = false })
    })
  }
}

/**
 * Run all scheduled sites for an interval — one at a time in sequence.
 * Sites are processed one by one to avoid hammering IndexNow.
 */
async function runScheduledForInterval(interval: keyof typeof SCHEDULES) {
  const due = db
    .select()
    .from(sites)
    .where(and(eq(sites.submissionLevel, 'scheduled'), eq(sites.cronInterval, interval)))
    .all()

  if (due.length === 0) return

  console.log(`[cron] Processing ${due.length} sites for interval "${interval}"`)

  for (const site of due) {
    console.log(`[cron] Submitting ${site.name}...`)
    try {
      const result = await runSubmission(site, 'scheduled')
      console.log(`[cron] ${site.name}: ${result.status} (${result.urlCount} URLs)`)
    } catch (err) {
      console.error(c.red(`[cron] Failed to submit ${site.name}:`), err)
    }
    // Small delay between sites to be polite to IndexNow
    if (due.length > 1) await new Promise((r) => setTimeout(r, 500))
  }

  console.log(`[cron] Done processing interval "${interval}"`)
}
