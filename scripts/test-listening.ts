/**
 * Checks listening practice's speech controls: the silent warm-up, and `r` to
 * replay — without `r` ever swallowing a typed answer.
 *
 *   npx tsx scripts/test-listening.ts
 *
 * Speech is recorded rather than played, so it runs silently and does not
 * depend on which voices the machine has. Uses the demo account.
 */

import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

/** Records every utterance instead of speaking it. A string: see test notes in CLAUDE.md on `__name`. */
const RECORD_SPEECH = `(() => {
  window.__spoken = [];
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.speak = (u) => window.__spoken.push({ text: u.text, volume: u.volume });
})();`;

interface Spoken {
  text: string;
  volume: number;
}

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(RECORD_SPEECH);
const page = await context.newPage();

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const spoken = () => page.evaluate("window.__spoken") as Promise<Spoken[]>;
const audible = async () => (await spoken()).filter((s) => s.volume !== 0);
const counter = () => page.locator(".quiz-progress span").first().textContent();

await page.goto(`${BASE}/practice/audio`, { waitUntil: "networkidle" });

console.log("\nWarm-up\n");

check("nothing spoken before the page is touched", (await spoken()).length === 0);

await page.fill("#count", "3");
await page.click('#setup-form button[type="submit"]');
await page.waitForSelector(".quiz-input", { timeout: 10_000 });
await page.waitForTimeout(150);

const afterStart = await spoken();
const warmIndex = afterStart.findIndex((s) => s.volume === 0);
const firstIndex = afterStart.findIndex((s) => s.volume !== 0);
check("a silent warm-up is spoken", warmIndex !== -1);
check("warm-up comes before the first word", warmIndex !== -1 && warmIndex < firstIndex, `${warmIndex} < ${firstIndex}`);
check("exactly one warm-up", afterStart.filter((s) => s.volume === 0).length === 1);

const word = afterStart[firstIndex]?.text ?? "";
check("the first word is spoken", word.trim().length > 0, `"${word}"`);

console.log("\nr then Enter replays\n");

check("hint mentions r", (await page.locator(".quiz-meta kbd").textContent())?.trim() === "r");

const beforeCounter = await counter();
const beforeCount = (await audible()).length;
await page.fill(".quiz-input", "r");
await page.press(".quiz-input", "Enter");
await page.waitForTimeout(250);

const replays = (await audible()).slice(beforeCount);
check("the word is spoken again", replays.length === 1 && replays[0]!.text === word, `"${replays[0]?.text ?? ""}"`);
check("no verdict — r is not an answer", (await page.locator(".verdict").count()) === 0);
check("the box is cleared", (await page.inputValue(".quiz-input")) === "");
check("nothing counted", (await counter()) === beforeCounter, `${beforeCounter?.trim()} -> ${(await counter())?.trim()}`);

console.log("\nTyping is untouched\n");

const beforeTyping = (await audible()).length;
await page.click(".quiz-input");
await page.keyboard.type("run");
check("r types normally in an answer", (await page.inputValue(".quiz-input")) === "run");
check("typing r does not replay", (await audible()).length === beforeTyping);

console.log("\nBare r after answering\n");

await page.fill(".quiz-input", "definitely wrong");
await page.press(".quiz-input", "Enter");
await page.waitForSelector(".verdict", { timeout: 10_000 });

const beforeBare = (await audible()).length;
await page.keyboard.press("r");
await page.waitForTimeout(150);
const bare = (await audible()).slice(beforeBare);
check("r replays once the answer is locked", bare.length === 1 && bare[0]!.text === word, `"${bare[0]?.text ?? ""}"`);
check("and does not move on", (await page.locator(".verdict").count()) === 1);

await page.keyboard.press("R");
await page.waitForTimeout(150);
check("capital R too", (await audible()).length === beforeBare + 2);

console.log("\nNext card\n");

await page.goto(`${BASE}/practice/audio`, { waitUntil: "networkidle" });
await page.fill("#count", "3");
await page.click('#setup-form button[type="submit"]');
await page.waitForSelector(".quiz-input", { timeout: 10_000 });
await page.fill(".quiz-input", "x");
await page.press(".quiz-input", "Enter");
await page.waitForSelector(".verdict", { timeout: 10_000 });
const beforeNext = (await audible()).length;
await page.click('#answer-form button[type="submit"]');
await page.waitForSelector(".verdict", { state: "detached", timeout: 10_000 });
await page.waitForTimeout(150);
check("continuing speaks the next word", (await audible()).length === beforeNext + 1);

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Listening controls work." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
