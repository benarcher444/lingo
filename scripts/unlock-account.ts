/**
 * Unlocks an account locked after too many wrong passwords.
 *
 *   npm run unlock                          # list locked accounts
 *   npm run unlock -- you@example.com
 *
 * The password stays as it was. If it may have been guessed, use
 * set-password.ts instead, which also unlocks.
 */

import { eq, isNotNull } from "drizzle-orm";

import { clearFailedLogins } from "../src/auth.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  const locked = db
    .select({ email: users.email, lockedAt: users.lockedAt })
    .from(users)
    .where(isNotNull(users.lockedAt))
    .all();

  console.log("\nLocked accounts:");
  for (const account of locked) console.log(`  ${account.email}  (since ${account.lockedAt})`);
  if (locked.length === 0) console.log("  none");
  console.log("\nUsage:  npm run unlock -- <email>\n");
  process.exit(0);
}

const target = db.select().from(users).where(eq(users.email, email)).get();

if (!target) {
  console.log(`\nNo account for "${email}".\n`);
  process.exit(1);
}

clearFailedLogins(target.id);

console.log(
  target.lockedAt
    ? `\nUnlocked ${target.email}. It can sign in again.\n`
    : `\n${target.email} was not locked. Its failed-attempt count is reset.\n`,
);
