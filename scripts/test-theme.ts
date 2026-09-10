/**
 * Checks the colour theme and the phone's controls. The choice is saved to the
 * account and stamped on every page, bad values are ignored, and the redirect
 * stays on this site. The phone gets a Settings tab, which covers account,
 * languages and theme.
 *
 *   npx tsx scripts/test-theme.ts
 *
 * Needs the server running and the demo account seeded. Puts the demo
 * account's theme back to Auto afterwards.
 */

import { eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const login = await fetch(`${BASE}/login`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ email: "demo@lingo.local", password: "demopassword" }),
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
if (!cookie.startsWith("ll_session=")) {
  console.log("\nCould not sign in as the demo account. Run npm run seed first.\n");
  process.exit(1);
}

const setTheme = (theme: string, referer?: string) =>
  fetch(`${BASE}/preferences/theme`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
      ...(referer ? { referer } : {}),
    },
    body: new URLSearchParams({ theme }),
  });

const page = async (path = "/vocab") => (await fetch(`${BASE}${path}`, { headers: { cookie } })).text();
const rootTag = (html: string) => html.match(/<html[^>]*>/)?.[0] ?? "";
const saved = () => db.select().from(users).where(eq(users.email, "demo@lingo.local")).get()?.theme;

try {
  console.log("\nTheme\n");

  check("starts on Auto, nothing forced", !rootTag(await page()).includes("data-theme"));

  const toDark = await setTheme("dark", `${BASE}/progress?language=1`);
  check(
    "saving returns to the page it came from",
    toDark.headers.get("location") === "/progress?language=1",
    toDark.headers.get("location") ?? "",
  );

  let html = await page();
  check("Dark is stamped on the page", rootTag(html).includes('data-theme="dark"'));
  check("and the browser uses dark controls", html.includes('<meta name="color-scheme" content="dark">'));
  check("the Dark button shows as chosen", /value="dark"[^>]*aria-pressed="true"/.test(html));

  await setTheme("light");
  check("Light is stamped too", rootTag(await page()).includes('data-theme="light"'));

  await setTheme("purple");
  check("an unknown value changes nothing", rootTag(await page()).includes('data-theme="light"'));

  const away = await setTheme("auto", "https://evil.example/phish");
  check("a foreign Referer sends you home, not away", away.headers.get("location") === "/");
  check("Auto clears it again", !rootTag(await page()).includes("data-theme"));
  check("it is saved on the account", saved() === "auto");

  console.log("\nPhone\n");

  html = await page("/vocab");
  // Switching language on a phone happens on Settings; the top bar is just the logo.
  check("the top bar has no language dropdown", !html.includes('class="mobile-lang"'));
  check("the bottom bar has a Settings tab", /<nav class="mobile-bar">[\s\S]*?href="\/settings"/.test(html));

  const settings = await page("/settings");
  check("Settings lists the languages to switch to", settings.includes('class="lang-choice"'));
  check("Settings can create a language", settings.includes('action="/languages"'));
  check("Settings has the theme switch", settings.includes('action="/preferences/theme"'));
  check("Settings can sign out to switch account", settings.includes('action="/logout"'));
} finally {
  db.update(users).set({ theme: "auto" }).where(eq(users.email, "demo@lingo.local")).run();
}

console.log(`\n${failures === 0 ? "Theme and phone controls work." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
