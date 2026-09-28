import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    db = new DatabaseSync(config.dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        github_login TEXT NOT NULL,
        github_token_enc TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtimes (
        user_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        creds_enc TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider_id)
      );
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        workdir TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        paid_consent INTEGER NOT NULL DEFAULT 0,
        allow_shared INTEGER NOT NULL DEFAULT 0,
        runtime_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workdir)
      );
      CREATE TABLE IF NOT EXISTS job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        line TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL
      );
    `);
  }
  return db;
}

export function audit(userId: string, action: string, detail: string) {
  getDb().prepare('INSERT INTO audit (ts, user_id, action, detail) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), userId, action, detail);
}
