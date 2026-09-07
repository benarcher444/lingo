/**
 * Removes only the seeded demo accounts, leaving real ones alone.
 *
 *   npx tsx scripts/remove-demo-accounts.ts
 *
 * `npm run seed` is handy for testing but leaves demo@lingo.local and
 * empty@lingo.local behind. This clears those without touching your own data —
 * unlike reset-users.ts, which removes everything.
 */

import { inArray } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const DEMO_EMAILS = ["demo@lingo.local", "empty@lingo.local"];

const found = db
  .select({ id: users.id, email: users.email })
  .from(users)
  .where(inArray(users.email, DEMO_EMAILS))
  .all();

if (found.length === 0) {
  console.log("\nNo demo accounts present.\n");
} else {
  db.delete(users)
    .where(inArray(users.id, found.map((u) => u.id)))
    .run();
  console.log(`\nRemoved: ${found.map((u) => u.email).join(", ")}`);
}

const remaining = db.select({ email: users.email }).from(users).all();
console.log(`Remaining accounts: ${remaining.map((u) => u.email).join(", ") || "none"}\n`);
