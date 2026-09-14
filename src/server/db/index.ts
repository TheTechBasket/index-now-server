import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.ts'

const dbPath = process.env.DATABASE_PATH ?? './data/indexnow.db'
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')
sqlite.pragma('synchronous = NORMAL')
sqlite.pragma('cache_size = -64000')
sqlite.pragma('temp_store = MEMORY')

export const db = drizzle(sqlite, { schema })

migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url)),
})

// Backfill host_mismatch for rows that predate the column (one-time, idempotent)
const unfilled = sqlite.prepare(
  `SELECT count(*) as n FROM submitted_urls su
   JOIN sites s ON s.id = su.site_id
   WHERE su.host_mismatch = 0
   AND su.url NOT LIKE ('https://' || s.host || '/%')
   AND su.url NOT LIKE ('http://' || s.host || '/%')
   AND su.url != ('https://' || s.host)
   AND su.url != ('http://' || s.host)`,
).get() as { n: number }
if (unfilled.n > 0) {
  console.log(`[db] Backfilling host_mismatch for ${unfilled.n} rows...`)
  sqlite.exec(
    `UPDATE submitted_urls SET host_mismatch = 1
     WHERE rowid IN (
       SELECT su.rowid FROM submitted_urls su
       JOIN sites s ON s.id = su.site_id
       WHERE su.host_mismatch = 0
       AND su.url NOT LIKE ('https://' || s.host || '/%')
       AND su.url NOT LIKE ('http://' || s.host || '/%')
       AND su.url != ('https://' || s.host)
       AND su.url != ('http://' || s.host)
     )`,
  )
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  console.log(`[db] Backfill complete`)
}

/** Flush the WAL back into the main db file. Large sitemap syncs can write tens of
 * thousands of rows in one go. Call this after so the WAL doesn't grow unbounded
 * and degrade every subsequent read (reads have to merge WAL frames). */
export function checkpoint() {
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
}
