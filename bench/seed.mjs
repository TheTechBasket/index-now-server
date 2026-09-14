// Seed script: creates a benchmark database with synthetic sites and URLs.
// Usage: node bench/seed.mjs [--target 1000000] [--sites 10] [--out bench/bench.db]
//
// Generates realistic-looking data (varied hosts, sitemaps, URL patterns,
// submissions) without needing any real/production data.

import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}

const target = Number(arg('target', '1000000'))
const siteCount = Number(arg('sites', '10'))
const out = arg('out', 'bench/bench.db')
const migrationsDir = resolve(import.meta.dirname, '../drizzle')

if (existsSync(out)) unlinkSync(out)

console.log(`Creating ${out} with ${siteCount} sites, ${target} URLs`)

const db = new Database(out)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = OFF')
db.pragma('cache_size = -256000')

// Apply migrations (same as server startup)
const { readdirSync, readFileSync } = await import('node:fs')
const journal = JSON.parse(readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf-8'))

db.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL,
  created_at INTEGER
)`)

const applied = new Set(db.prepare('SELECT hash FROM __drizzle_migrations').all().map(r => r.hash))
for (const entry of journal.entries) {
  if (applied.has(entry.tag)) continue
  const sql = readFileSync(resolve(migrationsDir, `${entry.tag}.sql`), 'utf-8')
  const statements = sql.split('--> statement-breakpoint')
  db.transaction(() => {
    for (const stmt of statements) {
      const trimmed = stmt.trim()
      if (trimmed) db.exec(trimmed)
    }
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(entry.tag, Date.now())
  })()
  console.log(`  Applied migration: ${entry.tag}`)
}

// Synthetic site data
const HOSTS = [
  'docs.example.com', 'shop.example.org', 'blog.testsite.net',
  'news.benchmark.dev', 'wiki.sample.io', 'app.demo.co',
  'store.fakeshop.com', 'portal.bigcorp.org', 'help.startup.dev',
  'media.content.net', 'api.platform.io', 'learn.academy.org',
  'tools.devsite.com', 'data.analytics.io', 'cdn.assets.net',
]

const URL_PATTERNS = [
  (host, i) => `https://${host}/page/${i}`,
  (host, i) => `https://${host}/blog/${Math.floor(i / 100)}/${i}`,
  (host, i) => `https://${host}/products/${i}-${randomBytes(3).toString('hex')}`,
  (host, i) => `https://${host}/docs/v${(i % 5) + 1}/section-${i}`,
  (host, i) => `https://${host}/category/${i % 50}/item-${i}`,
]

const now = Math.floor(Date.now() / 1000)
const DAY = 86400

// Insert sites
const insertSite = db.prepare(
  `INSERT INTO sites (id, name, host, sitemap_url, api_key, submission_level, cron_interval, last_sync_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

const sites = []
for (let i = 0; i < siteCount; i++) {
  const id = randomUUID()
  const host = HOSTS[i % HOSTS.length]
  const name = host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1) + ' ' + (i + 1)
  const level = ['manual', 'scheduled', 'webhook'][i % 3]
  const interval = ['hourly', 'daily', 'weekly'][i % 3]
  insertSite.run(id, name, host, `https://${host}/sitemap.xml`, randomBytes(16).toString('hex'), level, interval, now - DAY, now - DAY * 30)
  sites.push({ id, host })
}
console.log(`Inserted ${sites.length} sites`)

// Insert URLs (spread proportionally, with some sites larger)
const weights = sites.map((_, i) => i === 0 ? 4 : i < 3 ? 2 : 1)
const totalWeight = weights.reduce((a, b) => a + b, 0)
const perSite = sites.map((_, i) => Math.floor(target * weights[i] / totalWeight))
// Adjust remainder to first site
perSite[0] += target - perSite.reduce((a, b) => a + b, 0)

const insertUrl = db.prepare(
  `INSERT INTO submitted_urls (site_id, url, lastmod, first_seen_at, last_seen_at, submitted_at, submitted_lastmod, host_mismatch)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)

const BATCH = 5000
let total = 0
db.exec('BEGIN')
for (let s = 0; s < sites.length; s++) {
  const site = sites[s]
  const count = perSite[s]
  const pattern = URL_PATTERNS[s % URL_PATTERNS.length]
  for (let i = 0; i < count; i++) {
    const url = pattern(site.host, i)
    const lastmod = new Date((now - Math.floor(Math.random() * DAY * 60)) * 1000).toISOString().split('T')[0]
    const firstSeen = now - Math.floor(Math.random() * DAY * 30)
    const lastSeen = now - Math.floor(Math.random() * DAY * 2)
    // ~60% submitted, ~25% new, ~10% updated, ~5% with mismatched lastmod
    const submitted = Math.random() < 0.6
    const submittedAt = submitted ? firstSeen + DAY : null
    const submittedLastmod = submitted ? (Math.random() < 0.15 ? '2025-01-01' : lastmod) : null
    // ~1% host mismatch for realistic warning data
    const mismatch = Math.random() < 0.01 ? 1 : 0
    insertUrl.run(site.id, mismatch ? `https://wrong-host.example/${i}` : url, lastmod, firstSeen, lastSeen, submittedAt, submittedLastmod, mismatch)
    total++
    if (total % BATCH === 0) {
      db.exec('COMMIT')
      db.exec('BEGIN')
      process.stdout.write(`\r  URLs: ${total}/${target} (${Math.round(total / target * 100)}%)`)
    }
  }
}
db.exec('COMMIT')
console.log(`\nInserted ${total} URLs`)

// Insert synthetic submissions
const insertSub = db.prepare(
  `INSERT INTO submissions (site_id, trigger, url_count, status, detail, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
db.exec('BEGIN')
let subCount = 0
for (const site of sites) {
  for (let i = 0; i < 50; i++) {
    const trigger = ['manual', 'scheduled', 'webhook'][i % 3]
    const status = i % 10 === 0 ? 'error' : i % 5 === 0 ? 'no_changes' : 'success'
    const urlCount = Math.floor(Math.random() * 10000)
    const createdAt = now - Math.floor(Math.random() * DAY * 90)
    insertSub.run(site.id, trigger, urlCount, status, null, createdAt)
    subCount++
  }
}
db.exec('COMMIT')
console.log(`Inserted ${subCount} submissions`)

// Insert settings row
db.prepare('INSERT OR IGNORE INTO settings (id) VALUES (1)').run()

db.pragma('wal_checkpoint(TRUNCATE)')
db.close()

// Verify
const verify = new Database(out)
const urls = verify.prepare('SELECT count(*) as n FROM submitted_urls').get().n
const subs = verify.prepare('SELECT count(*) as n FROM submissions').get().n
const siteN = verify.prepare('SELECT count(*) as n FROM sites').get().n
verify.close()
console.log(`\nDone: ${siteN} sites, ${urls} URLs, ${subs} submissions in ${out}`)
