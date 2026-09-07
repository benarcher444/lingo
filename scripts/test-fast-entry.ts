/**
 * Drives the add-word flow with the keyboard only — type, Tab, type, Enter —
 * and checks that focus returns to the first field and nothing reloads.
 *
 *   npx tsx scripts/test-fast-entry.ts
 */

import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

const stamp = Date.now().toString().slice(-5);
const WORDS: [string, string][] = [
  [`le fromage ${stamp}`, "the cheese"],
  [`la fenêtre ${stamp}`, "the window"],
  [`le bruit ${stamp}`, "the noise"],
];

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const consoleErrors: string[] = [];
page.on("console", (m) => {
  // The duplicate check answers 409 by design, and the browser logs every
  // non-2xx fetch as a console error. That one is expected, not a fault.
  if (m.type() === "error" && !m.text().includes("409")) consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(e.message));

// The demo account already has a words table, so this also exercises the
// prepend-without-reload path.
await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });

// Mark the document so a full page reload is detectable.
await page.evaluate(() => {
  (window as unknown as { __noReload: boolean }).__noReload = true;
});

const rowsBefore = await page.locator("table.data tbody tr").count();
console.log(`\nRows before: ${rowsBefore}`);

const startFocus = await page.evaluate(() => document.activeElement?.id ?? "");
console.log(`Focus on load: ${startFocus || "(none)"} ${startFocus === "term" ? "✓" : "✗ expected term"}`);

let failures = 0;

for (const [term, english] of WORDS) {
  // Everything below is keyboard only — no clicks.
  await page.keyboard.type(term);
  await page.keyboard.press("Tab");
  await page.keyboard.type(english);
  await page.keyboard.press("Enter");

  await page.waitForFunction(
    (expected) => {
      const feedback = document.getElementById("add-feedback");
      return Boolean(feedback && !feedback.hidden && feedback.textContent?.includes(expected));
    },
    term,
    { timeout: 5000 },
  );

  const state = await page.evaluate(() => ({
    focused: document.activeElement?.id ?? "",
    termValue: (document.getElementById("term") as HTMLInputElement).value,
    englishValue: (document.getElementById("english") as HTMLInputElement).value,
    counter: document.getElementById("added-count")?.textContent ?? "",
  }));

  const ok =
    state.focused === "term" && state.termValue === "" && state.englishValue === "";

  if (!ok) failures += 1;

  console.log(
    `  ${ok ? "✓" : "✗"} "${term}" → focus=${state.focused || "(none)"} ` +
      `fields=${state.termValue === "" && state.englishValue === "" ? "cleared" : "NOT cleared"} ` +
      `· ${state.counter}`,
  );
}

const noReload = await page.evaluate(
  () => (window as unknown as { __noReload?: boolean }).__noReload === true,
);
console.log(`\nNo page reload during entry: ${noReload ? "✓" : "✗"}`);
if (!noReload) failures += 1;

const rowsAfter = await page.locator("table.data tbody tr").count();
console.log(`Rows after: ${rowsAfter} (expected ${rowsBefore + WORDS.length})`);
if (rowsAfter !== rowsBefore + WORDS.length) failures += 1;

// Duplicates should be reported, not silently swallowed.
const dup = WORDS[0]!;
await page.keyboard.type(dup[0]);
await page.keyboard.press("Tab");
await page.keyboard.type(dup[1]);
await page.keyboard.press("Enter");
await page.waitForTimeout(700);

const dupState = await page.evaluate(() => {
  const el = document.getElementById("add-feedback");
  return { text: el?.textContent ?? "", cls: el?.className ?? "" };
});
const dupHandled = dupState.cls.includes("error") && dupState.text.includes("already");
console.log(`Duplicate reported: ${dupHandled ? "✓" : "✗"} — "${dupState.text}"`);
if (!dupHandled) failures += 1;

if (consoleErrors.length > 0) {
  console.log(`\nConsole errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Fast entry works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
