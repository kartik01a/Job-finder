import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $sqlite: Database.Database;
};

const MIGRATION_SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations/0001_init.sql"),
  "utf8",
);

export function openDatabase(filename: string): AppDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  if (filename !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const existing = sqlite
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .get("0001_init") as { id: string } | undefined;
  if (!existing) {
    sqlite.exec(MIGRATION_SQL);
    sqlite
      .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
      .run("0001_init", Date.now());
  }
  const db = drizzle(sqlite, { schema });
  return Object.assign(db, { $sqlite: sqlite });
}

let singleton: AppDatabase | null = null;

export function getDatabase(filename: string): AppDatabase {
  if (!singleton) singleton = openDatabase(filename);
  return singleton;
}
