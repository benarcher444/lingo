/**
 * Checks sign-up by invitation, the lockout after 5 wrong passwords, unlocking,
 * the Secure cookie behind HTTPS, and the per-address limiter.
 *
 *   npx tsx scripts/test-auth.ts
 *
 * Needs the server running. Adds a throwaway address to allowed_emails.csv for
 * the duration, and removes it — and the account it creates — afterwards, even
 * if a check fails.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";

import { allowlistPath } from "../src/allowlist.js";
import { MAX_FAILED_LOGINS } from "../src/auth.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";
import { createLimiter } from "../src/rate-limit.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const INVITED = `auth-test-${Date.now()}@lingo.local`;
const STRANGER = `stranger-${Date.now()}@lingo.local`;
const PASSWORD = "correct horse battery";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });

const account = () => db.select().from(users).where(eq(users.email, INVITED)).get();
const cookieOf = (r: Response) => r.headers.get("set-cookie") ?? "";

const listPath = allowlistPath();
const originalList = existsSync(listPath) ? readFileSync(listPath, "utf8") : null;

try {
  const base = originalList ?? "email\n";
  writeFileSync(listPath, `${base}${base.endsWith("\n") ? "" : "\n"}${INVITED}\n`);

  console.log("\nSign-up by invitation\n");

  const stranger = await post("/register", { email: STRANGER, password: PASSWORD });
  check("an address not on the list is turned away", (await stranger.text()).includes("by invitation"));
  check("and no account is made", !db.select().from(users).where(eq(users.email, STRANGER)).get());

  const invited = await post("/register", { email: INVITED, password: PASSWORD });
  check(
    "an invited address can sign up",
    invited.status === 302 && cookieOf(invited).includes("ll_session"),
    `status ${invited.status}`,
  );

  console.log("\nSecure cookie\n");

  const plain = await post("/login", { email: INVITED, password: PASSWORD });
  check("plain HTTP: not Secure, so the home Wi-Fi still works", !/;\s*secure/i.test(cookieOf(plain)));

  const proxied = await post(
    "/login",
    { email: INVITED, password: PASSWORD },
    { "x-forwarded-proto": "https" },
  );
  check("behind the HTTPS proxy: Secure", /;\s*secure/i.test(cookieOf(proxied)));

  console.log("\nLockout\n");

  for (let i = 1; i <= MAX_FAILED_LOGINS; i++) {
    const html = await (await post("/login", { email: INVITED, password: "wrong password" })).text();
    if (i < MAX_FAILED_LOGINS) {
      const left = MAX_FAILED_LOGINS - i;
      check(`wrong password ${i} warns`, html.includes(`${left} attempt${left === 1 ? "" : "s"} left`));
    } else {
      check(`wrong password ${i} locks the account`, html.includes("locked"));
    }
  }

  const whileLocked = await post("/login", { email: INVITED, password: PASSWORD });
  check(
    "the right password is refused while locked",
    whileLocked.status !== 302 && (await whileLocked.text()).includes("locked"),
  );
  check("the lock is recorded", Boolean(account()?.lockedAt));

  execSync(`npx tsx scripts/unlock-account.ts ${INVITED}`, { stdio: "pipe" });
  check("the unlock script clears it", !account()?.lockedAt && account()?.failedLogins === 0);

  const afterUnlock = await post("/login", { email: INVITED, password: PASSWORD });
  check("then the right password works", afterUnlock.status === 302);

  await post("/login", { email: INVITED, password: "wrong password" });
  await post("/login", { email: INVITED, password: PASSWORD });
  check("a successful sign-in resets the count", account()?.failedLogins === 0);

  const unknown = await (await post("/login", { email: STRANGER, password: "wrong password" })).text();
  // "attempts left", not "left": the sign-in page itself says "where you left off".
  check(
    "an unknown address gets the plain message",
    unknown.includes("incorrect") && !/attempts? left/.test(unknown),
  );

  console.log("\nPer-address limiter\n");

  const limiter = createLimiter({ max: 3, windowMs: 1_000 });
  const t = 1_000_000;
  check("allows up to the limit", [1, 2, 3].every(() => limiter.allow("a", t)));
  check("then refuses", !limiter.allow("a", t));
  check("other addresses are unaffected", limiter.allow("b", t));
  check("and the window resets", limiter.allow("a", t + 1_001));
} finally {
  if (originalList === null) rmSync(listPath, { force: true });
  else writeFileSync(listPath, originalList);
  db.delete(users).where(inArray(users.email, [INVITED, STRANGER])).run();
}

check(
  "allowed_emails.csv restored",
  (existsSync(listPath) ? readFileSync(listPath, "utf8") : null) === originalList,
);

console.log(`\n${failures === 0 ? "Sign-in protection works." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
