/**
 * Applies any pending migrations to the database and says what it did.
 *
 *   npm run db:migrate
 *
 * `package.json` has referenced this file since the project began and it did
 * not exist, so the command has always failed with ERR_MODULE_NOT_FOUND. It
 * went unnoticed because `src/server.ts` calls `runMigrations()` at boot, so a
 * restart has always been enough — which is also why a deploy needs no
 * migration step. This is for the times you want to migrate *without* starting
 * the server: before a batch script, or to check a new migration applies at
 * all.
 */

import { databasePath, db, sqlite } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

const tables = () =>
  db.all<{ name: string }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" as any,
  );

const before = new Set(tables().map((t) => t.name));
runMigrations();
const after = tables().map((t) => t.name);
const added = after.filter((name) => !before.has(name));

console.log(`Migrated ${databasePath}`);
console.log(`  ${after.length} tables${added.length ? `, new: ${added.join(", ")}` : ", nothing new"}`);

sqlite.close();
