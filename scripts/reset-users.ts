/**
 * Deletes every user account and everything belonging to it.
 *
 *   npx tsx scripts/reset-users.ts          # show what would be deleted
 *   npx tsx scripts/reset-users.ts --yes    # actually delete
 *
 * Every table cascades from `users`, so removing a user takes their languages,
 * words, progress, attempts and history with them. A timestamped copy of the
 * database is written alongside it first — this is not recoverable otherwise.
 */

import { copyFileSync, existsSync } from "node:fs";

import { db, databasePath, sqlite } from "../src/db/index.js";
import {
  attempts,
  languages,
  progress,
  sessions,
  statSnapshots,
  users,
  wordTypes,
  words,
} from "../src/db/schema.js";

const confirmed = process.argv.includes("--yes");

const counts = {
  users: db.select().from(users).all().length,
  languages: db.select().from(languages).all().length,
  wordTypes: db.select().from(wordTypes).all().length,
  words: db.select().from(words).all().length,
  progress: db.select().from(progress).all().length,
  attempts: db.select().from(attempts).all().length,
  statSnapshots: db.select().from(statSnapshots).all().length,
  sessions: db.select().from(sessions).all().length,
};

console.log(`\nDatabase: ${databasePath}\n`);

const accounts = db.select({ id: users.id, email: users.email }).from(users).all();
for (const account of accounts) {
  console.log(`  ${account.email}`);
}
if (accounts.length === 0) console.log("  (no accounts)");

console.log("\nRows that will be removed:");
for (const [table, count] of Object.entries(counts)) {
  console.log(`  ${table.padEnd(14)} ${count}`);
}

if (!confirmed) {
  console.log("\nNothing deleted. Re-run with --yes to confirm.\n");
  process.exit(0);
}

if (existsSync(databasePath)) {
  const backup = `${databasePath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  // WAL mode keeps recent writes in a sidecar file, so checkpoint them into the
  // main database before copying or the backup misses them.
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(databasePath, backup);
  console.log(`\nBacked up to ${backup}`);
}

// Deleting users cascades, but the child tables are cleared explicitly so the
// result does not depend on foreign keys being enforced.
db.delete(attempts).run();
db.delete(progress).run();
db.delete(statSnapshots).run();
db.delete(words).run();
db.delete(wordTypes).run();
db.delete(languages).run();
db.delete(sessions).run();
db.delete(users).run();

// Reclaim the space and reset the autoincrement counters, so the next account
// created is user 1 rather than continuing from the old numbering.
sqlite.exec("DELETE FROM sqlite_sequence");
sqlite.exec("VACUUM");

const remaining = db.select().from(users).all().length;
console.log(`\nDone. ${remaining} account(s) remain.`);
console.log("Register a fresh account at http://localhost:3000/register\n");
