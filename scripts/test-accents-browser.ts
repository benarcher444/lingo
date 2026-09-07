/**
 * Types accented words into the real form with a real keyboard, and checks the
 * accent bar and Alt shortcuts work.
 *
 *   npx tsx scripts/test-accents-browser.ts
 */

import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("409")) errors.push(m.text());
});

await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });

let failures = 0;

async function typeInto(text: string): Promise<string> {
  await page.fill("#term", "");
  await page.focus("#term");
  await page.keyboard.type(text, { delay: 12 });
  return page.inputValue("#term");
}

async function expect(name: string, typed: string, want: string): Promise<void> {
  const got = await typeInto(typed);
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} typed "${typed}" -> "${got}"${ok ? "" : `  (wanted "${want}")`}`);
}

console.log("\nTyping accents in the real form\n");

await expect("acute", "cafe'", "café");
await expect("grave", "apre`s", "après");
await expect("circumflex", "e^tre", "être");
await expect("cedilla", "c,a va", "ça va");
await expect("a grave", "voila`", "voilà");
await expect("ligature", "coeur", "cœur");
await expect("apostrophe survives", "qu'est-ce", "qu'est-ce");
await expect("apostrophe survives 2", "l'eau", "l'eau");
await expect("double press keeps literal", "e''", "e'");

console.log("\nAccent bar\n");

const barCount = await page.locator(".accent-key").count();
console.log(`  ${barCount > 0 ? "ok  " : "FAIL"} bar rendered with ${barCount} characters`);
if (barCount === 0) failures += 1;

const firstChar = await page.locator(".accent-key").first().textContent();
const leadsWithE = firstChar?.startsWith("é") ?? false;
console.log(`  ${leadsWithE ? "ok  " : "FAIL"} leads with é (most common), got "${firstChar}"`);
if (!leadsWithE) failures += 1;

// Clicking must insert without stealing focus from the field.
await page.fill("#term", "caf");
await page.focus("#term");
await page.locator(".accent-key").first().click();
const afterClick = await page.inputValue("#term");
const clickOk = afterClick === "café";
console.log(`  ${clickOk ? "ok  " : "FAIL"} clicking é appends -> "${afterClick}"`);
if (!clickOk) failures += 1;

const focusHeld = await page.evaluate(() => document.activeElement?.id === "term");
console.log(`  ${focusHeld ? "ok  " : "FAIL"} focus stays in the field after clicking`);
if (!focusHeld) failures += 1;

// Alt+1 inserts the first bar character.
await page.fill("#term", "caf");
await page.focus("#term");
await page.keyboard.press("Alt+1");
const afterAlt = await page.inputValue("#term");
const altOk = afterAlt === "café";
console.log(`  ${altOk ? "ok  " : "FAIL"} Alt+1 inserts é -> "${afterAlt}"`);
if (!altOk) failures += 1;

console.log("\nSaving an accented word\n");

const word = `après-midi ${Date.now().toString().slice(-5)}`;
await page.fill("#term", "");
await page.focus("#term");
await page.keyboard.type(word.replace("è", "e`"), { delay: 12 });
await page.keyboard.press("Tab");
await page.keyboard.type("afternoon");
await page.keyboard.press("Enter");

await page.waitForFunction(
  () => {
    const el = document.getElementById("add-feedback");
    return Boolean(el && !el.hidden && el.className.includes("ok"));
  },
  undefined,
  { timeout: 5000 },
);

const savedRow = await page.locator("table.data tbody tr").first().locator(".term").textContent();
const savedOk = savedRow?.includes("après-midi") ?? false;
console.log(`  ${savedOk ? "ok  " : "FAIL"} stored with the accent intact -> "${savedRow?.trim()}"`);
if (!savedOk) failures += 1;

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Accent entry works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
