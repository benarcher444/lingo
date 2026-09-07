/**
 * Sets a new password for an account, for when you are locked out of your own
 * machine's copy.
 *
 *   npx tsx scripts/set-password.ts                        # list accounts
 *   npx tsx scripts/set-password.ts you@example.com newpassword123
 *
 * Passwords are argon2id hashes and cannot be read back — the only way in is to
 * set a new one. Existing sessions are cleared so the old password is dead
 * everywhere. Vocabulary and progress are untouched.
 */

import { eq } from "drizzle-orm";

import { hashPassword } from "../src/auth.js";
import { db } from "../src/db/index.js";
import { sessions, users } from "../src/db/schema.js";

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  const accounts = db.select({ id: users.id, email: users.email }).from(users).all();

  console.log("\nAccounts on this installation:");
  for (const account of accounts) console.log(`  ${account.email}`);
  if (accounts.length === 0) console.log("  (none — register at /register)");

  console.log("\nUsage:");
  console.log("  npx tsx scripts/set-password.ts <email> <new password>\n");
  process.exit(email || password ? 1 : 0);
}

if (password.length < 8) {
  console.log("\nPassword must be at least 8 characters.\n");
  process.exit(1);
}

const target = db
  .select()
  .from(users)
  .where(eq(users.email, email.trim().toLowerCase()))
  .get();

if (!target) {
  console.log(`\nNo account for "${email}".`);
  console.log("Run without arguments to list the accounts that exist.\n");
  process.exit(1);
}

db.update(users)
  .set({ passwordHash: await hashPassword(password) })
  .where(eq(users.id, target.id))
  .run();

// Any session opened with the old password should not survive the change.
db.delete(sessions).where(eq(sessions.userId, target.id)).run();

console.log(`\nPassword updated for ${target.email}.`);
console.log("Existing sessions were signed out. Log in with the new password.\n");
