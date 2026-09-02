import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'

const DRIZZLE_DIR = fileURLToPath(new URL('../../../drizzle', import.meta.url))

// Regression guard: drizzle runs every migration inside one transaction, where
// `PRAGMA foreign_keys=OFF` is a no-op. A migration that recreates `sites`
// (drizzle-kit's default for some column changes) therefore cascade-deletes every
// row in `submitted_urls` and `submissions`. This test migrates a DB to N-1, seeds
// child rows, applies the latest migration and asserts the rows survive.
describe('latest migration', () => {
  it('preserves submitted_urls and submissions rows (no cascade wipe)', () => {
    const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: { idx: number; tag: string }[]
    }
    const last = journal.entries[journal.entries.length - 1]
    expect(last.idx).toBeGreaterThan(0)

    // Build a migrations folder containing everything except the latest migration.
    const prevDir = mkdtempSync(join(tmpdir(), 'inx-mig-'))
    mkdirSync(join(prevDir, 'meta'))
    writeFileSync(
      join(prevDir, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx !== last.idx) }),
    )
    for (const f of readdirSync(DRIZZLE_DIR)) {
      if (f.endsWith('.sql') && !f.startsWith(last.tag)) copyFileSync(join(DRIZZLE_DIR, f), join(prevDir, f))
    }

    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: prevDir })

    sqlite.exec(`
      INSERT INTO sites (id, name, host, sitemap_url, api_key, created_at)
        VALUES ('s1', 'Example', 'example.com', 'https://example.com/sitemap.xml', 'key', 0);
      INSERT INTO submitted_urls (site_id, url) VALUES ('s1', 'https://example.com/a'), ('s1', 'https://example.com/b');
      INSERT INTO submissions (site_id, trigger, url_count, status, created_at) VALUES ('s1', 'manual', 2, 'success', 0);
    `)

    migrate(db, { migrationsFolder: DRIZZLE_DIR })

    const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    expect(count('sites')).toBe(1)
    expect(count('submitted_urls')).toBe(2)
    expect(count('submissions')).toBe(1)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
