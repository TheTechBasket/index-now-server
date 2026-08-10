import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// --- App tables ---
// No user_id anywhere — auth is a simple env gate, so data never belongs to a
// specific user. Changing ADMIN_EMAIL/.env keeps all your sites and URLs.

export const sites = sqliteTable('sites', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  host: text('host').notNull(),
  sitemapUrl: text('sitemap_url').notNull(),
  apiKey: text('api_key').notNull(),
  submissionLevel: text('submission_level', { enum: ['manual', 'scheduled', 'webhook'] })
    .notNull()
    .default('webhook'),
  cronInterval: text('cron_interval', { enum: ['hourly', '6h', 'daily', 'weekly', 'monthly'] })
    .notNull()
    .default('daily'),
  sitemapCount: integer('sitemap_count'),
  keyVerified: integer('key_verified', { mode: 'boolean' }).default(false),
  keyVerifiedAt: integer('key_verified_at', { mode: 'timestamp' }),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// Every URL known for a site — from sitemap syncs and webhook pushes.
// Status is derived: new (never submitted), updated (lastmod changed since submit),
// submitted (sent & unchanged), removed (gone from sitemap since last sync).
export const siteUrls = sqliteTable(
  'submitted_urls',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    lastmod: text('lastmod'), // raw <lastmod> from the sitemap
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
    submittedAt: integer('submitted_at', { mode: 'timestamp' }),
    submittedLastmod: text('submitted_lastmod'), // lastmod value at submission time
    statusCode: integer('status_code'),
  },
  (t) => [uniqueIndex('submitted_urls_site_url').on(t.siteId, t.url)],
)

export const submissions = sqliteTable('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: text('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  trigger: text('trigger', { enum: ['manual', 'scheduled', 'webhook'] }).notNull(),
  urlCount: integer('url_count').notNull(),
  status: text('status', { enum: ['success', 'no_changes', 'error'] }).notNull(),
  detail: text('detail'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// single-row settings table (id always 1)
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  discordWebhookUrl: text('discord_webhook_url'),
  events: text('events', { mode: 'json' }).$type<string[]>().notNull().default([]),
  webhookSecret: text('webhook_secret'),
})
