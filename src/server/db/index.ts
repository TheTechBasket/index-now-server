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

export const db = drizzle(sqlite, { schema })

migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../../drizzle', import.meta.url)),
})

/** Flush the WAL back into the main db file. Large sitemap syncs can write tens of
 * thousands of rows in one go — call this after so the WAL doesn't grow unbounded
 * and degrade every subsequent read (reads have to merge WAL frames). */
export function checkpoint() {
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
}
