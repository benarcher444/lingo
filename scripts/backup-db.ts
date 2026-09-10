/**
 * A consistent copy of the database, safe while the server is running. It uses
 * SQLite's online backup rather than a file copy, which could catch a write
 * half-done — and, in WAL mode, miss whatever is still in the -wal file.
 *
 *   npm run backup                                    # data/backups/app-2026-09-10.db, keeps 14
 *   npm run backup -- --label=pre-deploy --keep=10    # data/backups/pre-deploy-2026-09-10T14-05-00.db
 *
 * Two kinds, kept apart so one cannot push out the other:
 *   app         one per day, from the nightly timer (deploy/lingo-backup.timer)
 *   pre-deploy  one per deploy, timestamped, from deploy.sh
 *
 * They were once a single file per day. With deploy-on-push, a second deploy
 * the same day would then overwrite the only good copy taken before a first,
 * broken one.
 */

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { databasePath, sqlite } from "../src/db/index.js";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const label = arg("label") ?? "app";
const keep = Number(arg("keep") ?? 14);

// It becomes part of a file name.
if (!/^[a-z][a-z-]*$/.test(label)) {
  console.error(`--label must be lowercase letters and dashes, not "${label}"`);
  process.exit(1);
}

const now = new Date().toISOString();
// Nightly copies are one per day; everything else gets the time too.
const stamp = label === "app" ? now.slice(0, 10) : now.slice(0, 19).replace(/:/g, "-");

const dir = join(dirname(databasePath), "backups");
mkdirSync(dir, { recursive: true });

const target = join(dir, `${label}-${stamp}.db`);
await sqlite.backup(target);
console.log(`Backed up ${databasePath} → ${target}`);

// Oldest first to go, counting only this label's files. ISO stamps sort by time.
const pattern = new RegExp(`^${label}-\\d{4}-\\d{2}-\\d{2}(T[\\d-]+)?\\.db$`);
const old = readdirSync(dir)
  .filter((f) => pattern.test(f))
  .sort()
  .reverse()
  .slice(keep);

for (const file of old) {
  rmSync(join(dir, file));
  console.log(`Removed old backup ${file}`);
}
