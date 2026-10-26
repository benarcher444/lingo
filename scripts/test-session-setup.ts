/**
 * Checks the practice setup field and the "I don't know" path.
 *
 *   npx tsx scripts/test-session-setup.ts
 *
 * Uses the demo account so it never touches real vocabulary.
 */

import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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

console.log("\nHow many — free entry\n");

await page.goto(`${BASE}/practice/written`, { waitUntil: "networkidle" });

const field = page.locator("#count");
check("count is a text field, not a fixed dropdown", (await field.getAttribute("type")) === "number");
check("presets still offered", (await page.locator("#count-presets option").count()) === 4);

// An arbitrary number the old dropdown could not express.
await field.fill("7");
await page.waitForTimeout(120);
check("accepts an arbitrary number", (await field.inputValue()) === "7");

const hint = await page.locator("#count-hint").textContent();
// "12 available", or "23 due · 19 solid" when some words are solid and so not picked.
check("hint shows what is available", Boolean(hint && /\d+ (available|due)/.test(hint)), `"${hint?.trim()}"`);

// Switching to a smaller category should pull an oversized number down.
await field.fill("999");
await page.selectOption("#wordType", { index: 1 });
await page.waitForTimeout(150);
const clamped = Number(await field.inputValue());
const max = Number(await field.getAttribute("max"));
check("number clamped to the category size", clamped <= max && clamped > 0, `${clamped} <= ${max}`);

// Run a real session of exactly 7 words.
await page.selectOption("#wordType", { index: 0 });
await field.fill("7");
await page.click('#setup-form button[type="submit"]');
await page.waitForSelector(".quiz-input", { timeout: 10_000 });

const progress = await page.locator(".quiz-progress span").first().textContent();
// 7 words, both directions = 14 questions.
check("session honours the number typed", progress?.includes("/ 14") ?? false, `"${progress?.trim()}"`);

console.log("\nEmpty answer means 'I don't know'\n");

const before = await page.locator(".quiz-progress span").first().textContent();
await page.press(".quiz-input", "Enter");

await page.waitForSelector(".verdict", { timeout: 10_000 });

const headline = await page.locator(".verdict .headline").textContent();
check("submitting nothing is accepted", true);
check("shown as Skipped", headline?.trim() === "Skipped", `"${headline?.trim()}"`);
check("correct answer revealed", (await page.locator(".verdict .answer").count()) === 1);
check("no 'I was right' button after a skip", (await page.locator("#override").count()) === 0);

const wrongClass = await page.locator(".verdict").getAttribute("class");
check("counted as a miss", wrongClass?.includes("verdict-wrong") ?? false);

// Continue, and the skipped word must still be in the queue.
await page.click('#answer-form button[type="submit"]');
await page.waitForSelector(".quiz-input", { timeout: 10_000 });
const after = await page.locator(".quiz-progress span").first().textContent();
check("skipped word stays in the session", before === after, `${before?.trim()} -> ${after?.trim()}`);

console.log("\nPressing y overrides a miss\n");

// Answer wrongly so the override appears.
await page.fill(".quiz-input", "definitely wrong");
await page.press(".quiz-input", "Enter");
await page.waitForSelector("#override", { timeout: 10_000 });

check("override button offered after a real miss", true);
const kbdHint = await page.locator("#override kbd").textContent();
check("button shows the Y hint", kbdHint?.trim() === "Y", `"${kbdHint?.trim()}"`);
const standing = (await page.locator(".verdict .word-status").textContent()) ?? "";
check("the verdict says where the word stands", /New|Learning|Learnt|Solid/.test(standing), `"${standing}"`);
check("written practice has no 'You heard' line", (await page.locator(".verdict .heard").count()) === 0);

const beforeY = await page.locator(".quiz-progress span").first().textContent();
await page.keyboard.press("y");

// Wait for the verdict to GO, not for .quiz-input to appear — that element is
// always in the DOM (merely disabled), so waiting on it returns immediately and
// reads the progress before the override has landed.
await page.waitForSelector(".verdict", { state: "detached", timeout: 10_000 });

const afterY = await page.locator(".quiz-progress span").first().textContent();
check("y advanced past the question", beforeY !== afterY, `${beforeY?.trim()} -> ${afterY?.trim()}`);
check("verdict cleared", (await page.locator(".verdict").count()) === 0);

// y must not linger and act on the next question.
await page.fill(".quiz-input", "y");
const stillTyping = await page.inputValue(".quiz-input");
check("y types normally again afterwards", stillTyping === "y", `"${stillTyping}"`);
await page.fill(".quiz-input", "");

console.log("\nComing back to a session\n");

const counterBefore = await page.locator(".quiz-progress span").first().textContent();
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".quiz-input", { timeout: 10_000 });
check("a reload keeps the session", await page.locator("#setup").isHidden());
check(
  "at the same point",
  (await page.locator(".quiz-progress span").first().textContent()) === counterBefore,
  `${counterBefore?.trim()}`,
);

await page.goto(`${BASE}/settings`);
await page.goto(`${BASE}/practice/written`, { waitUntil: "networkidle" });
await page.waitForSelector(".quiz-input", { timeout: 10_000 });
check("so does a stray tap onto another page and back", await page.locator("#setup").isHidden());

await page.click("#end-session");
await page.waitForSelector("#summary:not([hidden])", { timeout: 10_000 });
await page.reload({ waitUntil: "networkidle" });
check("ending it for real clears it", await page.locator("#setup").isVisible());

console.log("\nThe banner updates without a reload\n");

// Mark the banner the page loaded with, so "it changed" can be told from "it
// was replaced by a fresh one".
await page.evaluate(() => {
  const banner = document.querySelector<HTMLElement>("#overview .progress-banner");
  if (banner) banner.dataset["stale"] = "1";
});

await page.selectOption("#wordType", { index: 0 });
await page.fill("#count", "1");
await page.click('#setup-form button[type="submit"]');
await page.waitForSelector(".quiz-input", { timeout: 10_000 });

// One word, both directions. Answer wrongly and override, so each direction is
// recorded as correct and the standing actually moves.
for (let i = 0; i < 2; i += 1) {
  await page.fill(".quiz-input", "almost certainly not the answer");
  await page.press(".quiz-input", "Enter");
  await page.waitForSelector("#override", { timeout: 10_000 });
  await page.keyboard.press("y");
  // "hidden", not "detached": on the last question the whole quiz is hidden
  // rather than emptied, so the verdict stays in the DOM out of sight.
  await page.waitForSelector(".verdict", { state: "hidden", timeout: 10_000 });
}

await page.waitForSelector("#summary:not([hidden])", { timeout: 10_000 });
await page.click("#again");
await page.waitForSelector("#overview:not([hidden])", { timeout: 10_000 });

const rebuilt = await page.evaluate(() => {
  const banner = document.querySelector<HTMLElement>("#overview .progress-banner");
  return {
    stale: banner?.dataset["stale"] ?? null,
    text: (banner?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
});
check("Practise again shows a rebuilt banner, not the one the page loaded", rebuilt.stale === null);

await page.reload({ waitUntil: "networkidle" });
const afterReload = await page.evaluate(() =>
  (document.querySelector("#overview .progress-banner")?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim(),
);
check("and it already said what a reload says", rebuilt.text === afterReload);

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Session setup works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
