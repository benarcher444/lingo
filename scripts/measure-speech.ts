/**
 * Measures how long listening practice takes to start speaking: from pressing
 * Start to the first sound, and for a later card to compare against.
 *
 *   npx tsx scripts/measure-speech.ts            # headless Chrome
 *   npx tsx scripts/measure-speech.ts --headed   # a real window, if headless has no voices
 *   npx tsx scripts/measure-speech.ts --runs=5
 *
 * Utterances are muted (volume 0), which does not change the timings. Each run
 * is a fresh browser, so the speech engine starts cold as it does for a user.
 * Needs the server running and the demo account seeded.
 */

import { chromium, type Browser } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const headed = process.argv.includes("--headed");
/** Press Start without touching the page first — the least warm-up time. */
const direct = process.argv.includes("--direct");
const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 3);

/**
 * Installed before any page script. A string rather than a function: tsx's
 * keepNames injects a `__name` helper the browser does not have.
 */
const INSTRUMENT = `(() => {
  const log = [];
  window.__speechLog = log;
  document.addEventListener("submit", (e) => {
    if (e.target && e.target.id === "setup-form") log.push({ kind: "start-pressed", at: performance.now() });
  }, true);
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const realSpeak = synth.speak.bind(synth);
  synth.speak = (u) => {
    const entry = {
      kind: "utterance",
      text: u.text,
      appVolume: u.volume,
      requested: performance.now(),
      voice: u.voice ? u.voice.name : null,
      local: u.voice ? u.voice.localService : null,
      voicesKnown: synth.getVoices().length,
      started: null,
      error: null,
    };
    log.push(entry);
    u.volume = 0;
    u.addEventListener("start", () => { entry.started = performance.now(); });
    u.addEventListener("error", (ev) => { entry.error = ev.error; });
    realSpeak(u);
  };
})();`;

interface Entry {
  kind: "start-pressed" | "utterance";
  at?: number;
  text?: string;
  /** Volume the app asked for, before muting — 0 marks the silent warm-up. */
  appVolume?: number;
  requested?: number;
  started?: number | null;
  voice?: string | null;
  local?: boolean | null;
  voicesKnown?: number;
  error?: string | null;
}

async function launch(): Promise<Browser> {
  // Playwright disables component extensions, and Chrome's Google voices —
  // the network-synthesised ones a real user gets — live in one. Without this
  // only the OS's local voices appear and the measurement is not what users hear.
  const options = {
    headless: !headed,
    ignoreDefaultArgs: ["--disable-component-extensions-with-background-pages"],
  };
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel, ...options });
    } catch {
      // Not installed — try the next one.
    }
  }
  return chromium.launch(options);
}

const fmt = (ms: number | null | undefined) => (ms == null ? "   —  " : `${ms.toFixed(0).padStart(5)}ms`);

async function run(index: number): Promise<void> {
  const browser = await launch();
  const context = await browser.newContext();
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/login`);
    await page.fill("#email", "demo@lingo.local");
    await page.fill("#password", "demopassword");
    await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);

    await page.goto(`${BASE}/practice/audio`, { waitUntil: "domcontentloaded" });

    if (index === 0) {
      const voices = (await page.evaluate(`new Promise((done) => {
        const list = () => speechSynthesis.getVoices();
        if (list().length) return done(list());
        speechSynthesis.addEventListener("voiceschanged", () => done(list()), { once: true });
        setTimeout(() => done(list()), 3000);
      }).then((vs) => vs.filter((v) => /^(fr|es)/i.test(v.lang))
        .map((v) => v.name + " [" + v.lang + "] " + (v.localService ? "local" : "NETWORK")))`)) as string[];
      console.log(`Voices for fr/es (${voices.length}):`);
      for (const v of voices) console.log(`  ${v}`);
      console.log("");
    }

    // A person clicks into the form and takes a moment before pressing Start.
    if (!direct) await page.click("#count");
    await page.waitForTimeout(1200);
    await page.fill("#count", "3");
    await page.click('#setup-form button[type="submit"]');

    const log = () => page.evaluate("window.__speechLog") as Promise<Entry[]>;
    const spoken = (entries: Entry[]) =>
      entries.filter((e) => e.kind === "utterance" && e.appVolume !== 0);

    const settled = async (n: number) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const real = spoken(await log());
        if (real.length >= n && (real[n - 1]!.started != null || real[n - 1]!.error)) return;
        await page.waitForTimeout(25);
      }
    };

    await settled(1);

    // Second card, for comparison once the engine is warm.
    await page.fill(".quiz-input", "x");
    await page.click('#answer-form button[type="submit"]');
    await page.waitForSelector(".verdict");
    await page.click('#answer-form button[type="submit"]');
    await settled(2);

    const entries = await log();
    const pressed = entries.find((e) => e.kind === "start-pressed")?.at ?? 0;
    const [first, second] = spoken(entries);
    const warmups = entries.filter((e) => e.kind === "utterance" && e.appVolume === 0);

    const line = (label: string, e: Entry | undefined, from: number | null) =>
      e
        ? `  ${label}  press→request ${fmt(from === null ? null : e.requested! - from)}  request→sound ${fmt(
            e.started == null ? null : e.started - e.requested!,
          )}  press→sound ${fmt(from === null || e.started == null ? null : e.started - from)}  voice=${
            e.voice ?? "(default)"
          }${e.local === false ? " NETWORK" : ""}  voicesKnown=${e.voicesKnown}${e.error ? `  ERROR ${e.error}` : ""}`
        : `  ${label}  (never spoke)`;

    console.log(`Run ${index + 1}${warmups.length ? `  (${warmups.length} warm-up utterance)` : ""}`);
    console.log(line("first ", first, pressed));
    console.log(line("second", second, null));
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  for (let i = 0; i < runs; i++) await run(i);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
