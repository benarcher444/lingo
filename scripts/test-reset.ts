/**
 * Checks the password-reset token, which is the part that has to be right.
 *
 *   npx tsx scripts/test-reset.ts
 *
 * A reset link is a bearer credential: whoever holds it owns the account for
 * the next hour. So the properties worth pinning are not "does the page
 * render" but the ones that stop a link being worth more than it should be —
 * it is single use, it expires, asking again kills the last one, and nothing
 * recoverable is left in the database.
 *
 * Runs against its own throwaway database, so it needs no server and no mail
 * provider and can set the awkward cases up exactly — an expired token is
 * written as expired rather than waited for.
 */

import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same trap as everywhere else: the database path is read when src/db is first
// imported and imports are hoisted, so everything below must be dynamic.
const workspace = mkdtempSync(join(tmpdir(), "lingo-reset-"));
process.env.DATABASE_PATH = join(workspace, "test.db");

const { db, sqlite } = await import("../src/db/index.js");
const { runMigrations } = await import("../src/db/migrate.js");
const { passwordResets, sessions, users } = await import("../src/db/schema.js");
const auth = await import("../src/auth.js");
const { emailProvider, emailFrom, appUrl } = await import("../src/email.js");

runMigrations();

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const user = db
  .insert(users)
  .values({ email: "reset@test.local", passwordHash: await auth.hashPassword("originalpw1") })
  .returning()
  .get();

console.log("\nIssuing a link");

const first = auth.createPasswordReset(user.id);
check("a token is returned", first.token.length > 20, `${first.token.length} chars`);
check(
  "it expires about an hour out",
  Math.abs(first.expiresAt.getTime() - Date.now() - auth.RESET_MINUTES * 60_000) < 5_000,
);

const stored = db.select().from(passwordResets).where(eq(passwordResets.userId, user.id)).all();
check("one row is stored", stored.length === 1);
check(
  "the plain token is NOT in the database",
  !stored.some((r) => r.tokenHash === first.token) &&
    !JSON.stringify(stored).includes(first.token),
  "a stolen copy of the table is worth nothing",
);

console.log("\nUsing it");

const found = auth.findPasswordReset(first.token);
check("the token is found", found.ok === true);
check("a token nobody issued is not", auth.findPasswordReset("not-a-real-token").ok === false);
check("an empty token is not", auth.findPasswordReset("").ok === false);

if (found.ok) {
  check("spending it works", auth.usePasswordReset(found.id) === true);
  check("spending it twice does not", auth.usePasswordReset(found.id) === false, "single use");
  const after = auth.findPasswordReset(first.token);
  check(
    "and it now reads as used, not unknown",
    after.ok === false && after.reason === "used",
    "pressing back on a spent link is common and harmless",
  );
}

console.log("\nAsking again");

const second = auth.createPasswordReset(user.id);
const third = auth.createPasswordReset(user.id);
check("each request gives a different token", second.token !== third.token);
const supersededLookup = auth.findPasswordReset(second.token);
check(
  "a newer request invalidates the older link",
  supersededLookup.ok === false && supersededLookup.reason === "used",
  "a forwarded old email must not stay usable",
);
check("the newest one still works", auth.findPasswordReset(third.token).ok === true);

console.log("\nExpiry");

const expiredToken = auth.createPasswordReset(user.id).token;
const live = db
  .select()
  .from(passwordResets)
  .where(eq(passwordResets.userId, user.id))
  .all()
  .find((r) => !r.usedAt);
db.update(passwordResets)
  .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
  .where(eq(passwordResets.id, live!.id))
  .run();
const expired = auth.findPasswordReset(expiredToken);
check(
  "an out-of-date link is refused",
  expired.ok === false && expired.reason === "expired",
  "and says so, rather than claiming it never existed",
);

console.log("\nWhat a completed reset closes");

db.insert(sessions)
  .values({
    id: "session-to-be-killed",
    userId: user.id,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
  .run();
auth.recordFailedLogin(user.id);
auth.recordFailedLogin(user.id);

// What the route does, in the same order.
const fresh = auth.createPasswordReset(user.id);
const lookup = auth.findPasswordReset(fresh.token);
if (lookup.ok) {
  auth.usePasswordReset(lookup.id);
  db.update(users)
    .set({ passwordHash: await auth.hashPassword("brandnewpw2") })
    .where(eq(users.id, lookup.userId))
    .run();
  db.delete(sessions).where(eq(sessions.userId, lookup.userId)).run();
  auth.clearFailedLogins(lookup.userId);
}

const after = db.select().from(users).where(eq(users.id, user.id)).get()!;
check("the new password works", await auth.verifyPassword(after.passwordHash, "brandnewpw2"));
check("the old one does not", !(await auth.verifyPassword(after.passwordHash, "originalpw1")));
check(
  "other devices are signed out",
  db.select().from(sessions).where(eq(sessions.userId, user.id)).all().length === 0,
);
check(
  "the failed-login count is cleared",
  after.failedLogins === 0 && after.lockedAt === null,
  "a reset is the way out of the five-wrong-passwords lock",
);

console.log("\nPruning");
const before = db.select().from(passwordResets).all().length;
auth.prunePasswordResets();
const remaining = db.select().from(passwordResets).all().length;
check("expired rows are dropped", remaining < before, `${before} -> ${remaining}`);

console.log("\nMail configuration");
check(
  "with nothing set, mail goes to the log rather than failing",
  emailProvider() === "console",
  "an unconfigured install still lets the operator read the link",
);
process.env.SMTP_HOST = "smtp.example.com";
check("setting SMTP_HOST is enough to switch to sending", emailProvider() === "smtp");
process.env.EMAIL_PROVIDER = "console";
check("and EMAIL_PROVIDER still wins", emailProvider() === "console");
delete process.env.SMTP_HOST;
delete process.env.EMAIL_PROVIDER;

process.env.APP_URL = "https://example.test/";
check(
  "APP_URL beats the request's own host",
  appUrl("http://attacker.example") === "https://example.test",
  "a reset link built from a Host header is how this feature gets abused",
);
delete process.env.APP_URL;
check("and without it the request origin is used", appUrl("http://localhost:3000") === "http://localhost:3000");
check("a from address is always produced", emailFrom().includes("@"));

sqlite.close();
rmSync(workspace, { recursive: true, force: true });

console.log(
  failures === 0
    ? "\nA reset link is single use, expiring, and worth nothing once spent.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
