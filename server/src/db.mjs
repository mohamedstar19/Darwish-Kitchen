import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Opens (and creates or upgrades) the SQLite database in `dataDir`. */
export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, 'kitchen.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  // node:sqlite turns foreign keys on by default; table rebuilds in migrations must run with them off,
  // or dropping the old `users` table would cascade-delete sessions and backups.
  db.exec('PRAGMA foreign_keys = OFF;');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

function migrate(db) {
  let version = db.prepare('PRAGMA user_version').get().user_version;

  if (version === 0 && !hasTable(db, 'users')) {
    // Fresh database: create the current schema directly.
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE,
        email TEXT UNIQUE COLLATE NOCASE,
        password_hash TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE backups (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    version = 2;
  }

  if (version < 2) {
    // v1 (email + password, deployed briefly) → v2 (phone login).
    // Rebuild `users` with phone and nullable email/password; old email accounts keep their data.
    db.exec(`
      BEGIN;
      CREATE TABLE users_v2 (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE,
        email TEXT UNIQUE COLLATE NOCASE,
        password_hash TEXT,
        created_at INTEGER NOT NULL
      );
      INSERT INTO users_v2 (id, email, password_hash, created_at) SELECT id, email, password_hash, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;
      COMMIT;
    `);
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length) throw new Error(`migration left ${broken.length} broken references`);
    version = 2;
  }

  if (version < 3) {
    // One pending code per phone number.
    db.exec(`
      CREATE TABLE IF NOT EXISTS otp_requests (
        phone TEXT PRIMARY KEY,
        request_id TEXT,
        code_hash TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    version = 3;
  }

  db.exec(`PRAGMA user_version = ${version}`);
}
