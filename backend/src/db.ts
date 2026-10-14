import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = path.join(import.meta.dirname, 'migrations');

/** One SQLite file in the data volume: fine for a single API instance (Postgres if it ever needs replicas). */
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** Applies migrations/NNN_*.sql above PRAGMA user_version, each in a transaction. */
function migrate(db: DatabaseSync) {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
