/**
 * Translation practice end to end against the stand-in AI: a sentence built
 * from your own words, the words revealed on request, marking with its notes
 * and a model answer, and a fresh round. Also covers adding a word straight
 * from the model sentence, and checks the mode records nothing — translation
 * must not touch scores.
 *
 *   AI_PROVIDER=mock npm start      # the server, with the stand-in (costs nothing)
 *   npx tsx scripts/test-sentences.ts
 *
 * Needs the demo account seeded.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { eq, like } from "drizzle-orm";

import { allowlistPath } from "../src/allowlist.js";
import { db } from "../src/db/index.js";
import { attempts, progress, words } from "../src/db/schema.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

// The demo account needs the AI switched on for this run; put the list back after.
const listPath = allowlistPath();
const originalList = existsSync(listPath) ? readFileSync(listPath, "utf8") : null;
const listBase = originalList ?? "email,ai\n";
writeFileSync(listPath, `${listBase}${listBase.endsWith("\n") ? "" : "\n"}demo@lingo.local,yes\n`);
process.on("exit", () => {
  if (originalList === null) rmSync(listPath, { force: true });
  else writeFileSync(listPath, originalList);
});

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const countRows = () => ({
  attempts: db.select().from(attempts).all().length,
  progress: db.select().from(progress).all().length,
});

const before = countRows();

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await context.newPage();

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/status of 40[0-9]/.test(m.text())) errors.push(m.text());
});

await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);

await page.goto(`${BASE}/practice/translate`, { waitUntil: "networkidle" });

console.log("\nSetup\n");

check("the page offers a word count", (await page.locator("#tr-count option").count()) >= 2);
check("and a level, starting at A1", (await page.inputValue("#tr-level")) === "A1");
check("drawn from any words by default", (await page.inputValue("#tr-weighting")) === "any");
check("it says scores are not affected", ((await page.textContent("#tr-sub")) ?? "").includes("not affected"));
check("no round until you start", await page.locator("#tr-round").isHidden());

console.log("\nA round\n");

await page.selectOption("#tr-count", "3");
await page.click('#tr-setup button[type="submit"]');
await page.waitForFunction(`document.querySelector("#tr-english").textContent.trim().length > 1`);

const english = (await page.textContent("#tr-english")) ?? "";
check("an English sentence to translate", english.includes("the sentence with"), `"${english}"`);
check("built from your own words", english.split(",").length >= 2 || english.split(" ").length > 4);
check("the words are hidden until asked for", await page.locator("#tr-words").isHidden());

await page.click("#tr-hint");
const pills = await page.locator("#tr-words .pill").count();
check("Show the words reveals them", pills === 3, `${pills} word(s)`);
check("and the button gives way", await page.locator("#tr-hint").isHidden());

console.log("\nMarking\n");

await page.fill("#tr-answer", "mi respuesta");
await page.click("#tr-check");
await page.waitForSelector(".tr-verdict");

check("a verdict", ((await page.textContent(".tr-verdict .headline")) ?? "").length > 0);
check("in the learner's own words", ((await page.textContent(".tr-comment")) ?? "").includes("mi respuesta"));
check("what to fix, itemised", (await page.locator(".tr-note").count()) >= 1);
check("and a model answer", ((await page.textContent(".tr-model-text")) ?? "").length > 0);

console.log("\nAdding a word from the model sentence\n");

// Unique per run, so the check cannot pass on a word left by an earlier one.
const gloss = `test gloss ${Date.now()}`;
const added = () => db.select().from(words).where(like(words.english, "test gloss %")).all();

// A run that fell over mid-test would leave a word behind, and the duplicate
// guard would then refuse the next one and read as a broken feature. Clear
// anything left over before starting, not only after finishing.
for (const row of added()) db.delete(words).where(eq(words.id, row.id)).run();

const wordButtons = page.locator(".tr-model-text .tr-word");
const howMany = await wordButtons.count();
check("every word of the model is clickable", howMany > 0, `${howMany} word(s)`);
check(
  "the punctuation is not offered as vocabulary",
  !((await page.textContent(".tr-model-text .tr-word")) ?? "").match(/[?¿.,!¡]/),
);
check("and the panel is shut until you ask", await page.locator("#tr-add").isHidden());

const firstWord = (await wordButtons.first().getAttribute("data-word")) ?? "";
await wordButtons.first().click();
await page.waitForSelector("#tr-add:not([hidden])");

check("tapping a word opens the add panel", await page.locator("#tr-add").isVisible());
check("with the word filled in", (await page.inputValue("#tr-add-term")) === firstWord, firstWord);
check("the meaning left to you", (await page.inputValue("#tr-add-english")) === "");
check("and a category to choose", (await page.locator("#tr-add-type option").count()) >= 2);
check("focus lands on the meaning", await page.locator("#tr-add-english").evaluate((el) => el === document.activeElement));

await page.fill("#tr-add-english", gloss);
await page.click("#tr-add-save");
// waitForSelector would wait for it to be *visible*, which a hidden panel never is.
await page.waitForFunction(`document.getElementById("tr-add").hidden === true`);

const saved = added();
check("the word is saved", saved.length === 1, `${saved.length} row(s)`);
check("with the word as typed", saved[0]?.term === firstWord, `${saved[0]?.term}`);
check("the panel closes on success", await page.locator("#tr-add").isHidden());
check("and the word is ticked off in the sentence", (await page.locator(".tr-word.is-added").count()) === 1);

// Adding it twice has to be refused, and say which entry already holds it.
await wordButtons.first().click();
await page.waitForSelector("#tr-add:not([hidden])");
await page.fill("#tr-add-english", `${gloss} again`);
await page.click("#tr-add-save");
await page.waitForFunction(`document.querySelector("#tr-add-msg").textContent.trim().length > 0`);

const complaint = (await page.textContent("#tr-add-msg")) ?? "";
check("a second copy is refused", complaint.length > 0, `"${complaint}"`);
check("and the refusal names the word", complaint.includes(firstWord), `"${complaint}"`);
check("so nothing is added twice", added().length === 1, `${added().length} row(s)`);

await page.click("#tr-add-cancel");
check("Cancel shuts the panel", await page.locator("#tr-add").isHidden());

// Added words are real vocabulary, so take them out again.
for (const row of added()) db.delete(words).where(eq(words.id, row.id)).run();
check("cleaned up after itself", added().length === 0);

console.log("\nAnother round\n");

await page.click("#tr-skip");
await page.waitForFunction(`document.querySelector("#tr-result").textContent.trim() === ""`);
await page.waitForFunction(`document.querySelector("#tr-english").textContent.trim().length > 1`);
check("a new sentence, and the marking cleared", (await page.locator(".tr-verdict").count()) === 0);
check("with an empty box to write in", (await page.inputValue("#tr-answer")) === "");

// The other draw, now that any words is the default one.
await page.selectOption("#tr-weighting", "due");
await page.click("#tr-skip");
await page.waitForFunction(`document.querySelector("#tr-english").textContent.trim().length > 1`);
check(
  "rounds from the words you're learning work too",
  ((await page.textContent("#tr-english")) ?? "").includes("the sentence with"),
);

console.log("\nIt records nothing\n");

const after = countRows();
check("no answers recorded", after.attempts === before.attempts, `${before.attempts} -> ${after.attempts}`);
check("no progress rows touched", after.progress === before.progress, `${before.progress} -> ${after.progress}`);

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Translation practice works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
