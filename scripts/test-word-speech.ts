/**
 * The word record's "Hear it" button: clicking a word on the vocabulary page
 * opens its record, and the button says the word in the language's voice.
 *
 *   npx tsx scripts/test-word-speech.ts
 *
 * Needs the server running and the demo account seeded. Speech is recorded
 * rather than played.
 */

import { eq } from "drizzle-orm";
import { chromium } from "playwright";

import { db } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

// Imported by path so the compiler does not try to type-check browser code.
const { spokenForm } = (await import("../public/voices.js" as string)) as {
  spokenForm: (text: string) => string;
};

/** Records utterances instead of speaking them. A string: see the __name trap. */
const RECORD_SPEECH = `(() => {
  window.__spoken = [];
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.speak = (u) => window.__spoken.push({ text: u.text, lang: u.lang });
})();`;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const word = db
  .select({ id: words.id, term: words.term, languageId: languages.id, code: languages.code })
  .from(words)
  .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
  .innerJoin(languages, eq(languages.id, wordTypes.languageId))
  .innerJoin(users, eq(users.id, languages.userId))
  .where(eq(users.email, "demo@lingo.local"))
  .get();
if (!word) {
  console.log("\nThe demo account has no words. Run npm run seed first.\n");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(RECORD_SPEECH);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);

console.log("\nThe word record\n");

await page.goto(`${BASE}/vocab?language=${word.languageId}&word=${word.id}`, { waitUntil: "networkidle" });
const button = page.locator(".detail-card button[data-speak]");
check("has a Hear it button", (await button.count()) === 1 && (await button.isVisible()));

await button.click();
const spoken = (await page.evaluate("window.__spoken")) as { text: string; lang: string }[];
check("which says the word", spoken.at(-1)?.text === spokenForm(word.term), `"${spoken.at(-1)?.text}" for "${word.term}"`);
check("in the language's voice", spoken.at(-1)?.lang === word.code, `${spoken.at(-1)?.lang}`);

await button.click();
check("and again on a second press", ((await page.evaluate("window.__spoken.length")) as number) === 2);
check("with no errors on the page", errors.length === 0, errors.join("; "));

console.log(`\n${failures === 0 ? "Hearing a word works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
