/**
 * Lists the elements pushing a page wider than the viewport, innermost first,
 * so the actual offender is obvious rather than the outermost container.
 *
 *   npx tsx scripts/diagnose-overflow.ts /vocab 390
 */

import { chromium } from "playwright";

const path = process.argv[2] ?? "/vocab";
const width = Number(process.argv[3] ?? 390);

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width, height: 844 } });
const page = await context.newPage();

await page.goto("http://localhost:3000/login");
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);

await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

const report = await page.evaluate((seen) => {
  const offenders: { tag: string; right: number; width: number; depth: number }[] = [];

  for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.right <= seen + 1 || rect.width === 0) continue;

    let depth = 0;
    let node: HTMLElement | null = el;
    while (node) {
      depth += 1;
      node = node.parentElement;
    }

    const id = el.id ? `#${el.id}` : "";
    const cls = el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` : "";

    offenders.push({
      tag: `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 70),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      depth,
    });
  }

  return {
    docWidth: document.documentElement.scrollWidth,
    seen,
    // Deepest first — the innermost element is usually the real cause.
    offenders: offenders.sort((a, b) => b.depth - a.depth).slice(0, 12),
  };
}, width);

console.log(`\n${path} at ${width}px — document is ${report.docWidth}px\n`);
for (const o of report.offenders) {
  console.log(`  depth ${String(o.depth).padStart(2)}  right ${String(o.right).padStart(4)}  w ${String(o.width).padStart(4)}  ${o.tag}`);
}
console.log();

await browser.close();
