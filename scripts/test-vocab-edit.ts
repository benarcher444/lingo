/**
 * Checks editing words in place on the vocabulary page: no reload, no jump back
 * to the top, and the add form's category left as it was — and remembered.
 *
 *   npx tsx scripts/test-vocab-edit.ts
 *
 * Uses the demo account. Every edit is put back, and the word it adds is deleted.
 */

import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

// Set on the page; a reload wipes it. Strings, not functions: see the __name trap.
const noReload = () => page.evaluate("window.__noReload === true") as Promise<boolean>;
const markPage = () => page.evaluate("window.__noReload = true");
const scrollY = () => page.evaluate("Math.round(window.scrollY)") as Promise<number>;
const englishOf = async (id: string) =>
  (await page.locator(`tr[data-word-id="${id}"] td`).nth(1).textContent())?.trim() ?? "";

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });

console.log("\nEdit opens in place\n");

// Pick a category other than the first, as someone adding a run of verbs would.
const chosen = (await page.locator("#wordTypeId option").nth(1).getAttribute("value")) ?? "";
const chosenName = (await page.locator("#wordTypeId option").nth(1).textContent())?.trim();
await page.selectOption("#wordTypeId", chosen);
await markPage();

const rows = page.locator("table.data tbody tr");
const target = rows.nth((await rows.count()) - 6);
const id = (await target.getAttribute("data-word-id")) ?? "";
await target.scrollIntoViewIfNeeded();
const before = await scrollY();
check("scrolled well down the list", before > 500, `${before}px`);

const urlBefore = page.url();
await target.locator("a[data-edit]").click();
const editor = page.locator(`tr.edit-row[data-word-id="${id}"]`);
await editor.waitFor({ timeout: 5_000 });

check("no reload", await noReload());
check("address unchanged", page.url() === urlBefore);
check("page stays where it was", Math.abs((await scrollY()) - before) < 40, `${before} -> ${await scrollY()}px`);
check("add category untouched", (await page.inputValue("#wordTypeId")) === chosen, `${chosenName}`);
check("word field focused", (await page.evaluate("document.activeElement && document.activeElement.name")) === "term");

console.log("\nSave in place\n");

const englishField = editor.locator("input[name=english]");
const original = await englishField.inputValue();
const edited = `${original} (edited)`;
await englishField.fill(edited);
await englishField.press("Enter");
await editor.waitFor({ state: "detached", timeout: 5_000 });

check("row shows the change", (await englishOf(id)) === edited, `"${await englishOf(id)}"`);
check("no reload", await noReload());
check("page stays where it was", Math.abs((await scrollY()) - before) < 40, `${before} -> ${await scrollY()}px`);
check("add category untouched", (await page.inputValue("#wordTypeId")) === chosen);
check(
  "saved row flashes",
  ((await page.locator(`tr[data-word-id="${id}"]`).getAttribute("class")) ?? "").includes("just-added"),
);

console.log("\nIt really saved, and the category is remembered\n");

await page.reload({ waitUntil: "networkidle" });
check("change persisted", (await englishOf(id)) === edited);
check("category remembered across a reload", (await page.inputValue("#wordTypeId")) === chosen, `${chosenName}`);

console.log("\nEscape cancels\n");

await markPage();
await page.locator(`tr[data-word-id="${id}"] a[data-edit]`).click();
await editor.waitFor({ timeout: 5_000 });
await editor.locator("input[name=english]").fill("should not be saved");
await editor.locator("input[name=english]").press("Escape");
await editor.waitFor({ state: "detached", timeout: 5_000 });
check("editor closed, nothing saved", (await englishOf(id)) === edited);
check("no reload", await noReload());

// Put the word back as it was.
await page.locator(`tr[data-word-id="${id}"] a[data-edit]`).click();
await editor.waitFor({ timeout: 5_000 });
await editor.locator("input[name=english]").fill(original);
await editor.locator("input[name=english]").press("Enter");
await editor.waitFor({ state: "detached", timeout: 5_000 });
check("change put back", (await englishOf(id)) === original);

console.log("\nFilters still travel\n");

const term = (await page.locator(`tr[data-word-id="${id}"] td.term a`).textContent())?.trim() ?? "";
await page.goto(`${BASE}/vocab?q=${encodeURIComponent(term)}`, { waitUntil: "networkidle" });
await page.locator(`tr[data-word-id="${id}"] a[data-edit]`).click();
await editor.waitFor({ timeout: 5_000 });
await editor.locator("input[name=english]").press("Enter");
await editor.waitFor({ state: "detached", timeout: 5_000 });
const href = (await page.locator(`tr[data-word-id="${id}"] a[data-edit]`).getAttribute("href")) ?? "";
check("saved row's links keep the search", href.includes(`q=${encodeURIComponent(term).replace(/%20/g, "+")}`) || href.includes("q="), href);
check("search still in the address", page.url().includes("q="));

console.log("\nA just-added word edits and deletes in place\n");

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle" });
await markPage();
const temp = `zz edit test ${Date.now()}`;
await page.fill("#term", temp);
await page.fill("#english", "temporary");
await page.press("#english", "Enter");
const added = page.locator("table.data tbody tr", { hasText: temp });
await added.waitFor({ timeout: 5_000 });

await added.locator("a[data-edit]").click();
const addedEditor = page.locator("tr.edit-row", { has: page.locator(`input[value="${temp}"]`) });
await addedEditor.waitFor({ timeout: 5_000 });
check("its Edit opens in place", await noReload());

page.once("dialog", (dialog) => dialog.accept());
await addedEditor.locator("button.btn-danger").click();
await addedEditor.waitFor({ state: "detached", timeout: 5_000 });
check("deleted row is gone", (await page.locator("table.data tbody tr", { hasText: temp }).count()) === 0);
check("no reload", await noReload());

await page.reload({ waitUntil: "networkidle" });
check("and stays gone", (await page.locator("table.data tbody tr", { hasText: temp }).count()) === 0);

console.log("\nWithout JavaScript\n");

const fallback = (await page.locator("a[data-edit]").first().getAttribute("href")) ?? "";
check("Edit still links to the edit view", fallback.includes("edit="), fallback);
check("and lands back on the row", /#word-\d+$/.test(fallback));

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Editing in place works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
