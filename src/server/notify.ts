import { db } from './db/index.ts'
import { settings } from './db/schema.ts'

export type EventKey =
  | 'schedule.success'
  | 'schedule.no_changes'
  | 'schedule.error'
  | 'manual.success'
  | 'manual.error'
  | 'webhook.error'
  | 'key_verification.failed'
  | 'sitemap.not_found'
  | 'sitemap.redirect'
  | 'sitemap.fetch_error'

export const EVENT_KEYS: EventKey[] = [
  'schedule.success',
  'schedule.no_changes',
  'schedule.error',
  'manual.success',
  'manual.error',
  'webhook.error',
  'key_verification.failed',
  'sitemap.not_found',
  'sitemap.redirect',
  'sitemap.fetch_error',
]

const COLORS = { success: 0x22c55e, error: 0xef4444, neutral: 0x64748b }

export async function notify(
  event: EventKey,
  fields: { site?: string; urlCount?: number; statusCode?: number; error?: string },
) {
  const row = db.select().from(settings).get()
  if (!row?.discordWebhookUrl || !row.events.includes(event)) return
  try {
    await sendDiscord(row.discordWebhookUrl, event, fields)
  } catch (err) {
    console.error('[Discord Notify Error]:', err instanceof Error ? err.message : err)
  }
}

export async function sendDiscord(
  webhookUrl: string,
  event: string,
  fields: { site?: string; urlCount?: number; statusCode?: number; error?: string },
) {
  const color = event.endsWith('error') || event.endsWith('failed')
    ? COLORS.error
    : event.endsWith('success')
      ? COLORS.success
      : COLORS.neutral

  const embedFields = [
    fields.site && { name: 'Site', value: fields.site, inline: true },
    fields.urlCount !== undefined && { name: 'URLs', value: String(fields.urlCount), inline: true },
    fields.statusCode !== undefined && { name: 'Status', value: String(fields.statusCode), inline: true },
    fields.error && { name: 'Error', value: fields.error.slice(0, 1000) },
  ].filter(Boolean)

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: `IndexNow — ${event}`,
          color,
          fields: embedFields,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Discord API returned HTTP ${res.status}${text ? `: ${text}` : ''}`)
  }
}
