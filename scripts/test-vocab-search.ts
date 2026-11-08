/**
 * Drives the vocabulary list's controls through the real form: search, the
 * category filter, the status filter and paging.
 *
 *   npx tsx scripts/test-vocab-search.ts
 *
 * Exists because search was silently broken: the "All types" option submits an
 * empty value, `Number("")` is 0, and `Number.isInteger(0)` is true — so every
 * search filtered on a category id of 0 and matched nothing. Testing the query
 * string directly would have missed it; only submitting the form catches it.
 *
 * Paging needs more words than the demo account holds, so it builds a language
 * of its own and removes it again at the end.
 */

import { chromium } from "playwright";
import { eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";

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

/** Its own language, built and removed by the paging section below. */
const PAGING_LANGUAGE = "Pagingish";

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

console.log("\nStatus filter\n");

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });

const statusCells = () =>
  page.locator("table.data tbody tr td:nth-child(4)").allTextContents();
const tickStatus = async (value: string) => {
  await Promise.all([
    page.waitForNavigation(),
    page.click(`.status-checks input[value="${value}"]`),
  ]);
};

// Which bands the demo data actually holds — seeded history leaves some
// bands empty, so the test picks its two from what is there rather than
// assuming a word has never been practised.
const BAND_VALUE: Record<string, string> = {
  New: "new",
  Learning: "learning",
  Learnt: "learnt",
  Solid: "solid",
  Off: "off",
};
const tally = new Map<string, number>();
for (const cell of await statusCells()) {
  const label = cell.trim().split(/\s+/)[0] ?? "";
  tally.set(label, (tally.get(label) ?? 0) + 1);
}
const present = [...tally.entries()]
  .filter(([label]) => BAND_VALUE[label])
  .sort((a, b) => b[1] - a[1]);
check("the list shows more than one band", present.length >= 2, present.map(([l, n]) => `${l}:${n}`).join(" "));

const [firstBand, firstCount] = present[0]!;
const [secondBand, secondCount] = present[1]!;

await tickStatus(BAND_VALUE[firstBand]!);
const oneBand = await rowCount();
const oneLabels = new Set((await statusCells()).map((s) => s.trim().split(/\s+/)[0]));
check(`ticking ${firstBand} narrows the list`, oneBand === firstCount && oneBand < total, `${oneBand} of ${total}`);
check("and every row shown is that band", oneLabels.size === 1 && oneLabels.has(firstBand), [...oneLabels].join(","));

await tickStatus(BAND_VALUE[secondBand]!);
const twoBands = await rowCount();
const twoLabels = new Set((await statusCells()).map((s) => s.trim().split(/\s+/)[0]));
check("a second band adds to the list", twoBands === firstCount + secondCount, `${twoBands} = ${firstCount}+${secondCount}`);
check(
  "and only those two bands show",
  [...twoLabels].every((l) => l === firstBand || l === secondBand),
  [...twoLabels].join(","),
);

// The boxes have to survive a search, as the other filters do.
const searchedWithin = await search("e");
check("status survives a search", searchedWithin <= twoBands, `${searchedWithin} <= ${twoBands}`);
check(
  "the boxes are still ticked",
  (await page.locator(`.status-checks input[value="${BAND_VALUE[firstBand]}"]`).isChecked()) &&
    (await page.locator(`.status-checks input[value="${BAND_VALUE[secondBand]}"]`).isChecked()),
);

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });
check("no box ticked shows everything", (await rowCount()) === total, `${await rowCount()} of ${total}`);

console.log("\nStatus and the mode it reports on\n");

await page.goto(`${BASE}/vocab?mode=speak`, { waitUntil: "networkidle" });
check(
  'the fifth band is "Not yet" in speaking',
  (await page.locator(".status-checks label").last().textContent())?.trim() === "Not yet",
);
await page.fill('input[name="q"]', "e");
await Promise.all([page.waitForNavigation(), page.click('button:has-text("Search")')]);
check(
  "searching from Speaking stays in Speaking",
  page.url().includes("mode=speak"),
  page.url(),
);

console.log("\nPaging\n");

// 150 words of its own: the demo account has nowhere near a pageful.
const account = db.select().from(users).where(eq(users.email, "demo@lingo.local")).get();
if (!account) throw new Error("demo account missing — run npm run seed");

db.delete(languages)
  .where(eq(languages.name, PAGING_LANGUAGE))
  .run();
const built = db
  .insert(languages)
  .values({ userId: account.id, name: PAGING_LANGUAGE, code: "es-US" })
  .returning()
  .get();

try {
  const builtType = db
    .insert(wordTypes)
    .values({ languageId: built.id, name: "nouns" })
    .returning()
    .get();
  db.insert(words)
    .values(
      Array.from({ length: 150 }, (_, i) => ({
        wordTypeId: builtType.id,
        term: `palabra ${String(i + 1).padStart(3, "0")}`,
        english: `word ${String(i + 1).padStart(3, "0")}`,
      })),
    )
    .run();

  const listed = () => page.locator(".list-head .sub").textContent();

  await page.goto(`${BASE}/vocab?language=${built.id}&sort=alpha`, { waitUntil: "networkidle" });
  check("a full page is a hundred rows", (await rowCount()) === 100, `${await rowCount()}`);
  check("the count says where you are", (await listed())?.includes("1–100 of 150") === true, `${await listed()}`);
  check("the pager says which page", (await page.locator(".pager .hint").textContent())?.trim() === "Page 1 of 2");
  check("there is nowhere before the first page", (await page.locator(".pager .is-disabled").count()) === 2);

  await Promise.all([page.waitForNavigation(), page.click('.pager a:has-text("Next")')]);
  check("Next shows the rest", (await rowCount()) === 50, `${await rowCount()}`);
  check("and counts them from 101", (await listed())?.includes("101–150 of 150") === true, `${await listed()}`);
  check("the oldest word is reachable", (await page.locator("table.data tbody tr").last().textContent())?.includes("palabra 150") === true);

  // Editing from page two has to come back to page two.
  await page.click('a[data-edit]');
  await page.waitForSelector("tr.edit-row", { timeout: 5_000 });
  const cancel = await page.locator("tr.edit-row a[data-cancel]").getAttribute("href");
  check("Edit keeps your place", cancel?.includes("page=2") === true, cancel ?? "");
  check(
    "and the form carries the page back",
    (await page.locator('tr.edit-row input[name="_page"]').first().inputValue()) === "2",
  );

  await page.goto(`${BASE}/vocab?language=${built.id}&sort=alpha&page=2`, { waitUntil: "networkidle" });
  await Promise.all([page.waitForNavigation(), page.click('.pager a:has-text("First")')]);
  check("First comes back to the start", (await listed())?.includes("1–100") === true, `${await listed()}`);

  // A page past the end is clamped rather than showing an empty table.
  await page.goto(`${BASE}/vocab?language=${built.id}&sort=alpha&page=99`, { waitUntil: "networkidle" });
  check("a page past the end lands on the last one", (await rowCount()) === 50, `${await rowCount()}`);
} finally {
  db.delete(languages).where(eq(languages.id, built.id)).run();
}

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Search works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
