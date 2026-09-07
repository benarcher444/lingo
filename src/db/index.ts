import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import * as schema from "./schema.js";

const databasePath = resolve(process.env.DATABASE_PATH ?? "data/app.db");
mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);

/**
 * WAL keeps readers from blocking the writer, which matters once a web server
 * can have several requests in flight. NORMAL synchronous trades a little
 * durability for far fewer fsyncs — the right call on a Pi's SD card.
 */
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { sqlite, databasePath };
export * from "./schema.js";
