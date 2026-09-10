/**
 * A consistent copy of the database, safe while the server is running. It uses
 * SQLite's online backup rather than a file copy, which could catch a write
 * half-done — and, in WAL mode, miss whatever is still in the -wal file.
 *
 *   npm run backup                 # → data/backups/app-2026-09-10.db, keeps 14
 *   npm run backup -- --keep=30
 *
 * On the server, deploy/lingo-backup.timer runs it nightly and deploy.sh runs
 * it before every update.
 */

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { databasePath, sqlite } from "../src/db/index.js";

const keep = Number(process.argv.find((a) => a.startsWith("--keep="))?.split("=")[1] ?? 14);

const dir = join(dirname(databasePath), "backups");
mkdirSync(dir, { recursive: true });

const target = join(dir, `app-${new Date().toISOString().slice(0, 10)}.db`);
await sqlite.backup(target);
console.log(`Backed up ${databasePath} → ${target}`);

const old = readdirSync(dir)
  .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f))
  .sort()
  .reverse()
  .slice(keep);

for (const file of old) {
  rmSync(join(dir, file));
  console.log(`Removed old backup ${file}`);
}
