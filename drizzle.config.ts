import type { Config } from "drizzle-kit";

/**
 * SQLite locally and on the Pi. Moving to Postgres for a hosted deployment
 * means changing `dialect` and the credentials block — the schema file itself
 * is portable.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "data/app.db",
  },
} satisfies Config;
