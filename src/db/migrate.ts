import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "./index.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Applied at server start. Drizzle tracks which migrations have run, so this is
 * a no-op once the database is current — which keeps deployment to the Pi to
 * "pull, restart".
 */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: join(projectRoot, "drizzle") });
}
