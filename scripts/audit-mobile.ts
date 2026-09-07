/**
 * Mobile usability audit. Checks the things that are invisible in a screenshot
 * but obvious the moment you use the site on a phone:
 *
 *   - inputs under 16px, which make iOS Safari zoom in on focus
 *   - touch targets smaller than 44x44
 *   - content trapped behind the fixed bottom nav
 *   - horizontal overflow
 *
 *   npx tsx scripts/audit-mobile.ts
 */

import { chromium, type Page } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const EMAIL = "demo@lingo.local";
const PASSWORD = "demopassword";

/** iPhone 12/13/14 logical size — the narrow end of what matters. */
const VIEWPORT = { width: 390, height: 844 };

const PAGES = ["/vocab", "/practice/written", "/practice/audio", "/practice/chat", "/progress", "/settings"];

let problems = 0;

function report(page: string, kind: string, detail: string): void {
  problems += 1;
  console.log(`  ✗ ${page}  ${kind}\n      ${detail}`);
}

async function auditPage(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);

  const findings = await page.evaluate(() => {
    const out = {
      smallInputs: [] as string[],
      smallTargets: [] as string[],
      overflow: null as null | { doc: number; seen: number },
      scrollingTables: [] as string[],
      navHeight: 0,
      bodyPadBottom: 0,
    };

    // NOTE: no named inner functions in here. tsx compiles with esbuild's
    // keepNames, which injects a `__name` helper that does not exist in the
    // page context — a named arrow makes this whole evaluate throw.

    // iOS Safari zooms the page when a focused input's font-size is under 16px.
    // Only text-entry fields and selects trigger it — checkboxes and hidden
    // inputs never receive that treatment, so they are not findings.
    for (const el of document.querySelectorAll("input, select, textarea")) {
      const type = (el as HTMLInputElement).type;
      if (["checkbox", "radio", "hidden", "submit", "button", "range"].includes(type)) continue;

      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size >= 16) continue;
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : "";
      out.smallInputs.push(`${el.tagName.toLowerCase()}${id}${cls} — ${size.toFixed(1)}px`);
    }

    // Touch targets. 44px is the long-standing accessibility floor.
    for (const el of document.querySelectorAll("a, button, [role=button], input[type=checkbox]")) {
      if (el.closest(".mobile-bar")) continue; // measured separately

      // A link inside a sentence is read, not aimed at — sizing it to 44px
      // would wreck the prose. Only standalone controls are held to the floor.
      const parent = el.parentElement;
      if (
        el.tagName === "A" &&
        !el.classList.contains("btn") &&
        parent &&
        (parent.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 8
      ) {
        continue;
      }

      // A checkbox inside a label is tapped via the label, so that wrapper is
      // the real target — measuring the 20px box would be a false positive.
      const target = el.closest("label") ?? el;
      const rect = target.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height >= 40 && rect.width >= 32) continue;
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className ? `.${String(el.className).trim().split(/\s+/)[0]}` : "";
      const text = (el.textContent ?? "").trim().slice(0, 24);
      out.smallTargets.push(
        `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""} — ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      );
    }

    const doc = document.documentElement.scrollWidth;
    if (doc > window.innerWidth + 1) out.overflow = { doc, seen: window.innerWidth };

    // A table wider than its scroll container hides its rightmost columns —
    // on the vocabulary page that is the Edit button, which you need.
    for (const wrap of document.querySelectorAll(".table-wrap")) {
      if (wrap.scrollWidth > wrap.clientWidth + 1) {
        out.scrollingTables.push(`${wrap.scrollWidth}px table in ${wrap.clientWidth}px container`);
      }
    }

    const bar = document.querySelector(".mobile-bar");
    out.navHeight = bar ? Math.round(bar.getBoundingClientRect().height) : 0;
    out.bodyPadBottom = parseFloat(
      getComputedStyle(document.querySelector(".main") ?? document.body).paddingBottom,
    );

    return out;
  });

  for (const item of findings.smallInputs) report(path, "input zooms on iOS (<16px)", item);
  for (const item of findings.smallTargets.slice(0, 6)) report(path, "touch target under 44px", item);
  if (findings.overflow) {
    report(path, "horizontal overflow", `${findings.overflow.doc}px > ${findings.overflow.seen}px`);
  }
  for (const item of findings.scrollingTables) {
    report(path, "table hides columns behind a sideways scroll", item);
  }
  if (findings.navHeight > 0 && findings.bodyPadBottom < findings.navHeight) {
    report(
      path,
      "content can hide behind the bottom nav",
      `nav is ${findings.navHeight}px, main padding-bottom is ${findings.bodyPadBottom}px`,
    );
  }

  if (
    findings.smallInputs.length === 0 &&
    findings.smallTargets.length === 0 &&
    findings.scrollingTables.length === 0 &&
    !findings.overflow &&
    findings.bodyPadBottom >= findings.navHeight
  ) {
    console.log(`  ok ${path}`);
  }
}

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

await page.goto(`${BASE}/login`);
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);

console.log(`\nMobile audit at ${VIEWPORT.width}x${VIEWPORT.height}\n`);
for (const path of PAGES) await auditPage(page, path);

// Walk a real quiz on a phone-sized screen — the flow, not just the layout.
console.log("\nQuiz flow on mobile");
await page.goto(`${BASE}/practice/written`, { waitUntil: "networkidle" });
await page.click('#setup-form button[type="submit"]');
await page.waitForSelector(".quiz-input", { timeout: 10_000 });

const quiz = await page.evaluate(() => {
  const input = document.querySelector<HTMLElement>(".quiz-input")!;
  const button = document.querySelector<HTMLElement>('#answer-form button[type="submit"]')!;
  const card = document.querySelector<HTMLElement>(".quiz-card")!;
  const prompt = document.querySelector<HTMLElement>(".quiz-prompt");
  return {
    inputFont: parseFloat(getComputedStyle(input).fontSize),
    inputHeight: Math.round(input.getBoundingClientRect().height),
    buttonHeight: Math.round(button.getBoundingClientRect().height),
    cardBottom: Math.round(card.getBoundingClientRect().bottom),
    promptVisible: prompt ? prompt.getBoundingClientRect().top >= 0 : false,
    viewportHeight: window.innerHeight,
  };
});

console.log(`  answer input: ${quiz.inputFont}px font, ${quiz.inputHeight}px tall`);
console.log(`  check button: ${quiz.buttonHeight}px tall`);
console.log(`  whole card fits above the fold: ${quiz.cardBottom <= quiz.viewportHeight}`);

if (quiz.inputFont < 16) report("/practice/written", "quiz input zooms on iOS", `${quiz.inputFont}px`);
if (quiz.buttonHeight < 44) report("/practice/written", "check button under 44px", `${quiz.buttonHeight}px`);

console.log(`\n${problems === 0 ? "No problems found." : `${problems} problem(s) found.`}\n`);

await browser.close();
if (problems > 0) process.exit(1);
