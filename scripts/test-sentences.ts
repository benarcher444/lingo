/**
 * Translation practice end to end against the stand-in AI: a sentence built
 * from your own words, the words revealed on request, marking with its notes
 * and a model answer, and a fresh round. Also checks it records nothing —
 * this mode must not touch scores.
 *
 *   AI_PROVIDER=mock npm start      # the server, with the stand-in (costs nothing)
 *   npx tsx scripts/test-sentences.ts
 *
 * Needs the demo account seeded.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { allowlistPath } from "../src/allowlist.js";
import { db } from "../src/db/index.js";
import { attempts, progress } from "../src/db/schema.js";

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
check("drawn from the words you're learning by default", (await page.inputValue("#tr-weighting")) === "due");
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

console.log("\nAnother round\n");

await page.click("#tr-skip");
await page.waitForFunction(`document.querySelector("#tr-result").textContent.trim() === ""`);
await page.waitForFunction(`document.querySelector("#tr-english").textContent.trim().length > 1`);
check("a new sentence, and the marking cleared", (await page.locator(".tr-verdict").count()) === 0);
check("with an empty box to write in", (await page.inputValue("#tr-answer")) === "");

await page.selectOption("#tr-weighting", "any");
await page.click("#tr-skip");
await page.waitForFunction(`document.querySelector("#tr-english").textContent.trim().length > 1`);
check("any-word rounds work too", ((await page.textContent("#tr-english")) ?? "").includes("the sentence with"));

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
