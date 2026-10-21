/**
 * Speaking practice: the English is shown, you say the word out loud, then
 * "Hear it" plays it and spells it out so you can mark yourself.
 *
 *   npx tsx scripts/test-speaking.ts
 *
 * Two things matter enough to be checked here. First, the mark is the answer —
 * it is the only place a client is allowed to say whether something was right,
 * so every other direction must ignore `selfMarked`. Second, speaking keeps
 * its own rows: a self-marked word must never move the listening score.
 *
 * Needs the server running and the demo account seeded. Speech is recorded
 * rather than played, so the browser half runs silently.
 */

import { and, eq } from "drizzle-orm";
import { chromium } from "playwright";

import { db } from "../src/db/index.js";
import { attempts, languages, progress, users } from "../src/db/schema.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

/* ------------------------------------------------------------------
   What the server records
   ------------------------------------------------------------------ */

const login = await fetch(`${BASE}/login`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ email: "demo@lingo.local", password: "demopassword" }),
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
if (!cookie.startsWith("ll_session=")) {
  console.log("\nCould not sign in as the demo account. Run npm run seed first.\n");
  process.exit(1);
}

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    data: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
};

const language = db
  .select({ id: languages.id })
  .from(languages)
  .innerJoin(users, eq(users.id, languages.userId))
  .where(eq(users.email, "demo@lingo.local"))
  .get();
if (!language) {
  console.log("\nThe demo account has no language. Run npm run seed first.\n");
  process.exit(1);
}

const start = await post("/api/practice/start", {
  languageId: language.id,
  mode: "speak",
  count: 2,
});
const cards = start.data.cards as { wordId: number; term: string; pending: string[] }[] | undefined;
const card = cards?.[0];
const sessionId = start.data.sessionId as string;
if (!card) {
  console.log("\nCould not start a speaking session.\n");
  process.exit(1);
}

console.log("\nA speaking session\n");

check("it asks one direction", card.pending.length === 1 && card.pending[0] === "say", card.pending.join());

const rows = (mode: string, direction: string) =>
  db
    .select()
    .from(attempts)
    .where(
      and(eq(attempts.wordId, card.wordId), eq(attempts.mode, mode), eq(attempts.direction, direction)),
    )
    .all();

const progressRow = (mode: string, direction: string) =>
  db
    .select()
    .from(progress)
    .where(
      and(eq(progress.wordId, card.wordId), eq(progress.mode, mode), eq(progress.direction, direction)),
    )
    .get();

const mark = (selfMarked: boolean | undefined) =>
  post("/api/practice/answer", {
    wordId: card.wordId,
    mode: "speak",
    direction: "say",
    answer: "",
    selfMarked,
    sessionId,
  });

const before = rows("speak", "say").length;
const listenBefore = JSON.stringify(progressRow("audio", "listen") ?? null);

console.log("\nMarking yourself right\n");

const right = await mark(true);
check("counts as correct", right.data.correct === true);
check("and names the word you should have said", right.data.expected === card.term, String(right.data.expected));
check("records one answer", rows("speak", "say").length === before + 1);
check("under speaking, not listening", rows("audio", "listen").length === 0);
check("the counts match the answers", progressRow("speak", "say")?.tested === before + 1);
check("the streak counts it", (progressRow("speak", "say")?.streak ?? 0) >= 1);
check(
  "it says where the word stands",
  typeof right.data.status === "string" && typeof right.data.previousStatus === "string",
  `${right.data.previousStatus} -> ${right.data.status}`,
);

console.log("\nMarking yourself wrong\n");

const wrong = await mark(false);
check("counts as a miss", wrong.data.correct === false);
check("records it", rows("speak", "say").length === before + 2);
check("and the streak resets", progressRow("speak", "say")?.streak === 0);

console.log("\nNo mark at all\n");

const silent = await mark(undefined);
check("is a miss, not a free pass", silent.data.correct === false);

console.log("\nThe listening score is untouched\n");

check(
  "listening has not moved",
  JSON.stringify(progressRow("audio", "listen") ?? null) === listenBefore,
  JSON.stringify(progressRow("audio", "listen") ?? null),
);

console.log("\nSelf-marking belongs to speaking alone\n");

const strayDirection = await post("/api/practice/answer", {
  wordId: card.wordId,
  mode: "audio",
  direction: "say",
  answer: "",
  selfMarked: true,
  sessionId,
});
check("a said answer cannot be filed under listening", strayDirection.status === 400, String(strayDirection.status));

const strayMode = await post("/api/practice/answer", {
  wordId: card.wordId,
  mode: "speak",
  direction: "listen",
  answer: "",
  sessionId,
});
check("nor a heard one under speaking", strayMode.status === 400, String(strayMode.status));

const claimed = await post("/api/practice/answer", {
  wordId: card.wordId,
  mode: "written",
  direction: "to_english",
  answer: "certainly not the answer",
  selfMarked: true,
  sessionId,
});
check(
  "a written answer is still judged by the server",
  claimed.status === 200 && claimed.data.correct === false,
  `${claimed.status} ${String(claimed.data.correct)}`,
);

/* ------------------------------------------------------------------
   The page itself
   ------------------------------------------------------------------ */

/** Records every utterance instead of speaking it. A string: see CLAUDE.md on `__name`. */
const RECORD_SPEECH = `(() => {
  window.__spoken = [];
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.speak = (u) => window.__spoken.push({ text: u.text, volume: u.volume });
})();`;

interface Spoken {
  text: string;
  volume: number;
}

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(RECORD_SPEECH);
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

const spoken = () => page.evaluate("window.__spoken") as Promise<Spoken[]>;
const audible = async () => (await spoken()).filter((s) => s.volume !== 0);

await page.goto(`${BASE}/practice/speak`, { waitUntil: "networkidle" });
await page.evaluate("localStorage.clear()");
await page.reload({ waitUntil: "networkidle" });

console.log("\nStarting a session on the page\n");

await page.fill("#count", "3");
await page.click('#setup-form button[type="submit"]');
await page.waitForSelector("#say-hear", { timeout: 10_000 });

check("the English is the prompt", ((await page.textContent(".quiz-prompt")) ?? "").trim().length > 0);
check("the card says to say it out loud", ((await page.textContent(".quiz-meta")) ?? "").includes("say it out loud"));
check("the word is not shown yet", await page.locator("#say-reveal").isHidden());
check("nor is it spoken yet", (await audible()).length === 0, String((await audible()).length));
check("there is nothing to mark yet", await page.locator("#say-mark").isHidden());
check("and no answer box", (await page.locator(".quiz-input").count()) === 0);

console.log("\nMarking before hearing it does nothing\n");

await page.keyboard.press("y");
await page.waitForTimeout(100);
check("y is ignored until the word is revealed", (await page.locator(".verdict").count()) === 0);

console.log("\nHear it\n");

await page.click("#say-hear");
await page.waitForTimeout(200);

const played = await audible();
check("the word is spoken", played.length === 1, `"${played[0]?.text ?? ""}"`);
check("and spelled out", await page.locator("#say-reveal").isVisible());
const shown = ((await page.textContent(".say-term")) ?? "").trim();
check("the spelling is the word that was said", shown.length > 0 && played[0]!.text.length > 0, `"${shown}"`);
check("now there is something to mark", await page.locator("#say-mark").isVisible());

await page.click("#say-hear");
await page.waitForTimeout(150);
check("pressing it again just replays", (await audible()).length === 2);
check("the marks stay up", await page.locator("#say-mark").isVisible());

console.log("\nSaying you had it\n");

await page.keyboard.press("y");
await page.waitForSelector(".verdict", { timeout: 10_000 });

check("the verdict is right", (await page.locator(".verdict-right").count()) === 1);
check("it shows where the word stands", (await page.locator(".verdict .word-status").count()) === 1);
check("there is no \"I was right\" — the mark was yours", (await page.locator("#override").count()) === 0);
check("the marks are gone", await page.locator("#say-mark").isHidden());

const continueButton = page.locator('#answer-form button[type="submit"]');
check("Continue is offered", await continueButton.isVisible());
check("and it says Continue", ((await continueButton.textContent()) ?? "").trim() === "Continue");

console.log("\nThe next word\n");

await continueButton.click();
await page.waitForSelector(".verdict", { state: "detached", timeout: 10_000 });
await page.waitForTimeout(150);

check("nothing is spoken until you ask", (await audible()).length === 2, String((await audible()).length));
check("the next word is hidden again", await page.locator("#say-reveal").isHidden());

await page.click("#say-hear");
await page.waitForTimeout(150);
await page.keyboard.press("n");
await page.waitForSelector(".verdict", { timeout: 10_000 });
check("n marks it wrong", (await page.locator(".verdict-wrong").count()) === 1);
check("and it is not read as a skip", !((await page.textContent(".verdict .headline")) ?? "").includes("Skipped"));

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Speaking practice works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
