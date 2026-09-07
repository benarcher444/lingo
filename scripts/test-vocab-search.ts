/**
 * Drives the vocabulary search and category filter through the real form.
 *
 *   npx tsx scripts/test-vocab-search.ts
 *
 * Exists because search was silently broken: the "All types" option submits an
 * empty value, `Number("")` is 0, and `Number.isInteger(0)` is true — so every
 * search filtered on a category id of 0 and matched nothing. Testing the query
 * string directly would have missed it; only submitting the form catches it.
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

const rowCount = () => page.locator("table.data tbody tr").count();

async function search(term: string): Promise<number> {
  await page.fill('input[name="q"]', term);
  await Promise.all([page.waitForNavigation(), page.click('button:has-text("Search")')]);
  return rowCount();
}

console.log("\nVocabulary search\n");

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });
const total = await rowCount();
check("word list loads", total > 0, `${total} rows`);

const chien = await search("chien");
check("finds a target-language word", chien >= 1 && chien < total, `${chien} of ${total}`);

const dog = await search("dog");
check("finds by English too", dog >= 1 && dog < total, `${dog} rows`);

const none = await search("zzzznotaword");
check("no match shows nothing", none === 0, `${none} rows`);

const cleared = await search("");
check("clearing restores the full list", cleared === total, `${cleared} of ${total}`);

// The search box should still hold what was typed after submitting.
await page.fill('input[name="q"]', "chien");
await Promise.all([page.waitForNavigation(), page.click('button:has-text("Search")')]);
check("search box keeps its value", (await page.inputValue('input[name="q"]')) === "chien");

console.log("\nCategory filter\n");

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });
await Promise.all([page.waitForNavigation(), page.selectOption('select[name="type"]', { index: 1 })]);
const filtered = await rowCount();
check("filtering by category narrows the list", filtered > 0 && filtered < total, `${filtered} of ${total}`);

// Category plus search together.
const combined = await search("e");
check("category and search combine", combined <= filtered, `${combined} <= ${filtered}`);

// Back to all types — this is the combination that used to return nothing.
await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });
await page.selectOption('select[name="type"]', { index: 0 });
const restored = await search("chien");
check("All types + search works", restored >= 1, `${restored} rows`);

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Search works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
