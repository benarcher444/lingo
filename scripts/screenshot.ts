/**
 * Screenshots every page at desktop and mobile widths, in light and dark, so
 * the UI can be reviewed without clicking through by hand.
 *
 *   npm run shot                  # all pages, both widths, both themes
 *   npm run shot -- --only=vocab  # just the pages whose key matches
 *   npm run shot -- --light       # skip the dark pass
 *   npm run shot -- --viewport    # visible area only (checks fixed chrome)
 *
 * Requires the dev server to be running (npm run dev) and the demo account to
 * exist (npm run seed).
 */

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
/** --viewport captures only the visible area instead of the whole page. */
const viewportOnly = process.argv.includes("--viewport");
const OUT = join(process.cwd(), "screenshots");

const EMAIL = "demo@lingo.local";
const EMPTY_EMAIL = "empty@lingo.local";
const PASSWORD = "demopassword";

interface Shot {
  key: string;
  path: string;
  /** Run before capturing — e.g. click into a quiz. */
  prepare?: (page: Page) => Promise<void>;
  authenticated: boolean;
  /** Sign in as the account with no vocabulary, to capture empty states. */
  asEmptyUser?: boolean;
}

const SHOTS: Shot[] = [
  { key: "login", path: "/login", authenticated: false },
  { key: "register", path: "/register", authenticated: false },
  { key: "vocab", path: "/vocab", authenticated: true },
  { key: "written", path: "/practice/written", authenticated: true },
  {
    key: "written-quiz",
    path: "/practice/written",
    authenticated: true,
    prepare: async (page) => {
      await page.click('#setup-form button[type="submit"]');
      await page.waitForSelector(".quiz-card", { timeout: 10_000 });
    },
  },
  {
    key: "written-verdict",
    path: "/practice/written",
    authenticated: true,
    prepare: async (page) => {
      await page.click('#setup-form button[type="submit"]');
      await page.waitForSelector(".quiz-input", { timeout: 10_000 });
      await page.fill(".quiz-input", "definitely not the right answer");
      await page.click('#answer-form button[type="submit"]');
      await page.waitForSelector(".verdict", { timeout: 10_000 });
    },
  },
  {
    key: "word-detail",
    path: "/vocab",
    authenticated: true,
    prepare: async (page) => {
      await page.click("a.term-link");
      await page.waitForSelector(".detail-card", { timeout: 10_000 });
    },
  },
  { key: "audio", path: "/practice/audio", authenticated: true },
  { key: "chat", path: "/practice/chat", authenticated: true },
  { key: "progress", path: "/progress", authenticated: true },
  { key: "settings", path: "/settings", authenticated: true },

  // Empty states — the account with no language and no words.
  { key: "empty-vocab", path: "/vocab", authenticated: true, asEmptyUser: true },
  { key: "empty-written", path: "/practice/written", authenticated: true, asEmptyUser: true },
  { key: "empty-audio", path: "/practice/audio", authenticated: true, asEmptyUser: true },
  { key: "empty-chat", path: "/practice/chat", authenticated: true, asEmptyUser: true },
  { key: "empty-progress", path: "/progress", authenticated: true, asEmptyUser: true },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found?.split("=")[1];
}

/**
 * Prefer a browser already installed on the machine (Chrome, then Edge) and
 * only fall back to Playwright's own download. Saves a ~150MB fetch on a dev
 * box, and on the Pi it picks up the system Chromium.
 */
async function launchBrowser(): Promise<Browser> {
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // Not installed — try the next one.
    }
  }

  try {
    return await chromium.launch();
  } catch (error) {
    console.error(
      "No browser available. Install one with: npx playwright install chromium",
    );
    throw error;
  }
}

async function signIn(page: Page, email = EMAIL): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function capture(
  browser: Browser,
  shot: Shot,
  viewport: (typeof VIEWPORTS)[number],
  theme: "light" | "dark",
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  try {
    if (shot.authenticated) await signIn(page, shot.asEmptyUser ? EMPTY_EMAIL : EMAIL);

    await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle" });
    if (shot.prepare) await shot.prepare(page);

    // Let fonts and any transition settle.
    await page.waitForTimeout(350);

    const file = join(OUT, `${shot.key}-${viewport.name}-${theme}.png`);
    // fullPage renders position:fixed elements at their scroll position, which
    // makes the mobile nav bar look like it sits mid-page. --viewport captures
    // just the visible area, which is how fixed chrome should be reviewed.
    await page.screenshot({ path: file, fullPage: !viewportOnly });

    // A page wider than its viewport means something is forcing horizontal
    // scroll — easy to miss in a fullPage screenshot, obvious to use.
    const overflow = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const seen = window.innerWidth;
      if (docWidth <= seen + 1) return null;

      // Name the widest offender so the fix is obvious.
      let culprit = "";
      let widest = 0;
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const right = el.getBoundingClientRect().right;
        if (right > seen + 1 && right > widest) {
          widest = right;
          culprit = el.className
            ? `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`
            : el.tagName.toLowerCase();
        }
      }
      return { docWidth, seen, culprit };
    });

    const flags = [
      errors.length > 0 ? `⚠ ${errors.length} console error(s)` : "",
      overflow
        ? `⚠ overflows ${overflow.docWidth}px > ${overflow.seen}px (${overflow.culprit})`
        : "",
    ]
      .filter(Boolean)
      .join("  ");

    console.log(`  ${shot.key}-${viewport.name}-${theme}${flags ? `  ${flags}` : ""}`);
    for (const error of errors.slice(0, 3)) console.log(`      ${error}`);
  } catch (error) {
    console.log(`  ✗ ${shot.key}-${viewport.name}-${theme}: ${(error as Error).message.split("\n")[0]}`);
    // Console errors are usually the actual cause of a failed prepare step.
    for (const message of errors.slice(0, 5)) console.log(`      console: ${message}`);
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  const only = arg("only");
  const lightOnly = process.argv.includes("--light");
  const desktopOnly = process.argv.includes("--desktop");

  const shots = only ? SHOTS.filter((s) => s.key.includes(only)) : SHOTS;
  const viewports = desktopOnly ? VIEWPORTS.slice(0, 1) : VIEWPORTS;
  const themes: ("light" | "dark")[] = lightOnly ? ["light"] : ["light", "dark"];

  if (shots.length === 0) {
    console.error(`No shots match --only=${only}`);
    process.exit(1);
  }

  // Confirm the server is up before launching a browser.
  try {
    const response = await fetch(`${BASE}/login`);
    if (!response.ok) throw new Error(`${response.status}`);
  } catch {
    console.error(`Cannot reach ${BASE}. Start the server with: npm run dev`);
    process.exit(1);
  }

  if (!only) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await launchBrowser();
  console.log(`Capturing ${shots.length} page(s) → screenshots/\n`);

  for (const shot of shots) {
    for (const viewport of viewports) {
      for (const theme of themes) {
        await capture(browser, shot, viewport, theme);
      }
    }
  }

  await browser.close();
  console.log(`\nDone → ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
