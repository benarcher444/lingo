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

import { asc, eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { languages, users } from "../src/db/schema.js";

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

/** A second language, added for the language checks and removed afterwards. */
let addedLanguageId: number | undefined;

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
  check("the bottom bar has a Settings tab", /<nav class="mobile-bar">[\s\S]*?href="\/settings(\?language=\d+)?"/.test(html));

  const settings = await page("/settings");
  check("Settings lists the languages to switch to", settings.includes('class="lang-choice"'));
  check("Settings can create a language", settings.includes('action="/languages"'));
  check("Settings has the theme switch", settings.includes('action="/preferences/theme"'));
  check("Settings can sign out to switch account", settings.includes('action="/logout"'));

  console.log("\nLanguage\n");

  // Settings used to open on whichever language sorts first, whatever you had
  // been working in, and show that one as current. "Zulu" sorts after the demo
  // account's own language, so falling back to the first would show.
  const added = await fetch(`${BASE}/languages`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ name: "Zulu" }),
  });
  addedLanguageId = Number(/language=(\d+)/.exec(added.headers.get("location") ?? "")?.[1]) || undefined;
  const cookieFrom = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  check("creating a language remembers it", cookieFrom(added) === `ll_language=${addedLanguageId}`, cookieFrom(added));

  const owned = db
    .select({ id: languages.id })
    .from(languages)
    .innerJoin(users, eq(users.id, languages.userId))
    .where(eq(users.email, "demo@lingo.local"))
    .orderBy(asc(languages.name))
    .all();
  check("the added language is not the first", owned.length > 1 && owned[0]?.id !== addedLanguageId);

  const current = (body: string) =>
    body.match(/class="lang-choice" href="[^"]*language=(\d+)[^"]*" aria-current="true"/)?.[1];

  html = await page(`/vocab?language=${addedLanguageId}`);
  check("the Settings tab keeps the language", html.includes(`href="/settings?language=${addedLanguageId}"`));
  check(
    "so Settings shows it as current",
    current(await page(`/settings?language=${addedLanguageId}`)) === String(addedLanguageId),
  );

  const switched = await fetch(`${BASE}/switch-language?language=${addedLanguageId}&return=settings`, {
    redirect: "manual",
    headers: { cookie },
  });
  const remembered = cookieFrom(switched);
  check("switching remembers the language", remembered === `ll_language=${addedLanguageId}`, remembered);
  const bare = await (await fetch(`${BASE}/settings`, { headers: { cookie: `${cookie}; ${remembered}` } })).text();
  check("a page reached without it opens on that one", current(bare) === String(addedLanguageId));
  check("and without the cookie, on the first again", current(await page("/settings")) === String(owned[0]?.id));
} finally {
  db.update(users).set({ theme: "auto" }).where(eq(users.email, "demo@lingo.local")).run();
  if (addedLanguageId) db.delete(languages).where(eq(languages.id, addedLanguageId)).run();
}

console.log(`\n${failures === 0 ? "Theme and phone controls work." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
