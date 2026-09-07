/**
 * Checks that "words tested today" counts the way a daily target does:
 * two sessions over the same three words is six, not three.
 *
 *   npx tsx scripts/test-daily-count.ts
 */

import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("/login")),
  page.click('button[type="submit"]'),
]);

const languageId = await page.evaluate(async () => {
  const res = await fetch("/vocab");
  const html = await res.text();
  return Number(html.match(/name="language" value="(\d+)"/)?.[1] ?? 0);
});

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

/** Reads the two figures from the written-practice panel of the Today card. */
async function todayFigures(): Promise<{ tested: number; distinct: number }> {
  await page.goto(`${BASE}/progress?language=${languageId}`, { waitUntil: "networkidle" });
  return page.evaluate(() => {
    const panel = document.querySelectorAll(".today-mode")[0];
    const figures = panel?.querySelectorAll(".today-figure") ?? [];
    return {
      tested: Number(figures[0]?.textContent?.trim() ?? 0),
      distinct: Number(figures[1]?.textContent?.trim() ?? 0),
    };
  });
}

/** Plays one full session of `count` words, answering everything correctly. */
async function playSession(count: number): Promise<void> {
  const result = await page.evaluate(
    async ([lang, n]) => {
      const start = await fetch("/api/practice/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ languageId: lang, mode: "written", count: n }),
      }).then((r) => r.json());

      // Answer every direction of every card correctly.
      for (const card of start.cards) {
        for (const direction of card.pending) {
          await fetch("/api/practice/answer", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              wordId: card.wordId,
              mode: "written",
              direction,
              answer: direction === "from_english" ? card.term : card.english,
              sessionId: start.sessionId,
            }),
          });
        }
      }

      return { sessionId: start.sessionId, words: start.cards.length };
    },
    [languageId, count] as const,
  );

  console.log(`     played a session of ${result.words} words (session ${String(result.sessionId).slice(0, 8)}…)`);
}

console.log("\nDaily count: sessions add up, repeats included\n");

const before = await todayFigures();
console.log(`     starting from ${before.tested} tested / ${before.distinct} distinct`);

await playSession(3);
const afterFirst = await todayFigures();
check(
  "a 3-word session adds 3",
  afterFirst.tested === before.tested + 3,
  `${before.tested} -> ${afterFirst.tested}`,
);

await playSession(3);
const afterSecond = await todayFigures();
check(
  "a second 3-word session adds 3 more, even with overlap",
  afterSecond.tested === afterFirst.tested + 3,
  `${afterFirst.tested} -> ${afterSecond.tested}`,
);

check(
  "distinct words never exceeds words tested",
  afterSecond.distinct <= afterSecond.tested,
  `${afterSecond.distinct} distinct <= ${afterSecond.tested} tested`,
);

check(
  "the two figures are genuinely different measures",
  afterSecond.tested > 0 && afterSecond.distinct > 0,
  `${afterSecond.tested} tested, ${afterSecond.distinct} distinct`,
);

console.log(`\n${failures === 0 ? "Daily counting works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
