/**
 * The notice that says why nothing was heard.
 *
 *   npx tsx scripts/test-speech-notice.ts
 *
 * Browser speech fails silently, and that is the whole problem: no engine, no
 * voice data, and no voice for *this* language all produce the same nothing,
 * so "the sound does not work" is the only report a learner can give. The app
 * names which it is on the page. This drives the three cases by handing the
 * page a different voice list each time, because waiting to meet a device with
 * no Spanish voice is not a test.
 *
 * It exists because the notice was written for a fault on someone else's phone
 * that could not be reproduced here — so the one thing that *can* be checked
 * from here is that the notice itself works.
 *
 * Needs the server running and the demo account seeded.
 */

import { eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";

import { db } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

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

const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  en: "English",
};
const spoken = LANGUAGE_NAMES[(word.code ?? "").slice(0, 2).toLowerCase()] ?? word.code;

/**
 * Hands the page a voice list of our choosing. A string, not a function: tsx
 * compiles with esbuild's keepNames, which injects a __name helper the browser
 * does not have — see the trap in CLAUDE.md.
 */
const withVoices = (list: { lang: string; name: string }[]) => `(() => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices = () => ${JSON.stringify(list)};
  window.speechSynthesis.speak = () => {};
})();`;

/** Opens the word record with that voice list, and clicks Hear it. */
async function hearIt(browser: Browser, voices: { lang: string; name: string }[]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(withVoices(voices));
  const page = await context.newPage();

  await page.goto(`${BASE}/login`);
  await page.fill("#email", "demo@lingo.local");
  await page.fill("#password", "demopassword");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/login")),
    page.click('button[type="submit"]'),
  ]);

  await page.goto(`${BASE}/vocab?language=${word!.languageId}&word=${word!.id}`, {
    waitUntil: "networkidle",
  });

  return { context, page, button: page.locator(".detail-card button[data-speak]") };
}

const browser = await chromium.launch({ channel: "chrome" });

/* ------------------------------------------------------------------
   A device with voices, but none for this language
   ------------------------------------------------------------------ */

console.log("\nNo voice for this language\n");

{
  const { context, page, button } = await hearIt(browser, [
    { lang: "en-GB", name: "English (UK)" },
    { lang: "en-US", name: "English (US)" },
  ]);

  // Nothing is claimed before speech has even been attempted.
  check("nothing is said until you ask for sound", (await page.locator(".speech-trouble").count()) === 0);

  await button.click();
  await page.waitForSelector(".speech-trouble", { timeout: 5_000 });

  const said = (await page.textContent(".speech-trouble")) ?? "";
  check("the page says there is no sound", said.includes("No sound"), `"${said.slice(0, 60)}…"`);
  check(
    "and names the language it is missing",
    said.includes(`no ${spoken} voice installed`),
    `"${said}"`,
  );
  check("with somewhere to go about it", said.includes("Text-to-speech output"));

  // It is a notice, not a crash: the rest of the page still works.
  check("the Hear it button is still there", await button.isVisible());

  await button.click();
  check("and it is only said once", (await page.locator(".speech-trouble").count()) === 1);

  await context.close();
}

/* ------------------------------------------------------------------
   A device with no voices at all
   ------------------------------------------------------------------ */

console.log("\nNo voices at all\n");

{
  const { context, page, button } = await hearIt(browser, []);

  await button.click();
  // An empty list is normal for a moment, so the app waits before blaming the
  // device. That delay is the thing being checked here.
  await page.waitForSelector(".speech-trouble", { timeout: 6_000 });

  const said = (await page.textContent(".speech-trouble")) ?? "";
  check(
    "an empty voice list is reported as the device having none",
    said.includes("no speech voices installed"),
    `"${said.slice(0, 70)}…"`,
  );

  await context.close();
}

/* ------------------------------------------------------------------
   A device that can speak the language
   ------------------------------------------------------------------ */

console.log("\nA voice that fits\n");

{
  const { context, page, button } = await hearIt(browser, [
    { lang: word.code ?? "fr-FR", name: "Test voice" },
  ]);

  await button.click();
  // Long enough that the delayed re-check would have fired had it been going to.
  await page.waitForTimeout(2_500);

  check(
    "nothing is said when the language has a voice",
    (await page.locator(".speech-trouble").count()) === 0,
    (await page.textContent(".speech-trouble").catch(() => "")) ?? "",
  );

  await context.close();
}

console.log(`\n${failures === 0 ? "The no-sound notice works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
