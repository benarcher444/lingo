/**
 * Checks the two gates on what a mode may ask for:
 *
 * - **listening** asks only for words already answered in written practice;
 * - **speaking** asks only for words solid in written and in listening, and a
 *   word keeps everything it has earned if it falls back out again.
 *
 *   npx tsx scripts/test-practice-pools.ts
 *
 * Both live in `loadScoredWords`, so they are tested together: the way they
 * compose is the part most likely to break. A word solid in written but never
 * heard must be offered by listening and withheld by speaking at the same
 * time, and neither gate may read the other one's filtered output.
 *
 * Runs against its own throwaway database, so it needs no server, no seeded
 * account and nothing of the real data — which is also why it can set up the
 * awkward cases exactly (a muted word, a word that has decayed back below
 * solid) rather than hoping to find one.
 */

import { and, eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The database path is read when src/db/index.ts is first imported, and
// imports are hoisted — so everything that reaches the database has to be
// imported dynamically, after this line. Same trap as .env in server.ts.
const workspace = mkdtempSync(join(tmpdir(), "lingo-speak-pool-"));
process.env.DATABASE_PATH = join(workspace, "test.db");

const { db, sqlite } = await import("../src/db/index.js");
const { runMigrations } = await import("../src/db/migrate.js");
const { languages, progress, users, wordTypes, words } = await import("../src/db/schema.js");
const { loadScoredWords } = await import("../src/stats.js");
const { isListeningReady, isSpeakingReady, today } = await import("../src/algorithm.js");

runMigrations();

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

/* ------------------------------------------------------------------
   The rule on its own
   ------------------------------------------------------------------ */

console.log("\nThe speaking rule\n");

const SOLID = 3.5;
const LEARNT = 2.5; // over the learnt line at 2.3, under solid at 2.556

check(
  "solid in both is ready",
  isSpeakingReady({ inWritten: true, writtenScore: SOLID, inListening: true, listeningScore: SOLID }),
);
check(
  "solid in written, only learnt in listening, is not",
  !isSpeakingReady({ inWritten: true, writtenScore: SOLID, inListening: true, listeningScore: LEARNT }),
);
check(
  "solid in listening, only learnt in written, is not",
  !isSpeakingReady({ inWritten: true, writtenScore: LEARNT, inListening: true, listeningScore: SOLID }),
);
check(
  "a word kept out of listening is judged on written alone",
  isSpeakingReady({ inWritten: true, writtenScore: SOLID, inListening: false, listeningScore: 0 }),
);
check(
  "and still has to be solid there",
  !isSpeakingReady({ inWritten: true, writtenScore: LEARNT, inListening: false, listeningScore: 0 }),
);
check(
  "a word kept out of written is judged on listening alone",
  isSpeakingReady({ inWritten: false, writtenScore: 0, inListening: true, listeningScore: SOLID }),
);
check(
  "a word in neither mode has nothing to qualify it",
  !isSpeakingReady({ inWritten: false, writtenScore: 0, inListening: false, listeningScore: 0 }),
);

/* ------------------------------------------------------------------
   The pool the app actually builds
   ------------------------------------------------------------------ */

const user = db
  .insert(users)
  .values({ email: "pool@test.local", passwordHash: "x" })
  .returning()
  .get();
const language = db
  .insert(languages)
  .values({ userId: user.id, name: "Testish", code: "es-US" })
  .returning()
  .get();
const type = db
  .insert(wordTypes)
  .values({ languageId: language.id, name: "nouns" })
  .returning()
  .get();

/**
 * A word with a chosen standing in each mode. "solid" is ten right answers on
 * a streak — 3.5 in either mode; "learnt" is five without one, which is 2.5:
 * over the learnt line and under solid, the case the gate exists for.
 */
function makeWord(opts: {
  term: string;
  written?: "solid" | "learnt";
  listening?: "solid" | "learnt";
  writtenEnabled?: boolean;
  audioEnabled?: boolean;
  speakEnabled?: boolean;
}): number {
  const word = db
    .insert(words)
    .values({
      wordTypeId: type.id,
      term: opts.term,
      english: opts.term,
      writtenEnabled: opts.writtenEnabled ?? true,
      audioEnabled: opts.audioEnabled ?? true,
      speakEnabled: opts.speakEnabled ?? true,
    })
    .returning()
    .get();

  const lastTested = today();

  if (opts.written) {
    const n = opts.written === "solid" ? 10 : 5;
    const streak = opts.written === "solid" ? 3 : 0;
    for (const direction of ["to_english", "from_english"]) {
      db.insert(progress)
        .values({ wordId: word.id, mode: "written", direction, tested: n, correct: n, streak, lastTested })
        .run();
    }
  }

  if (opts.listening) {
    const n = opts.listening === "solid" ? 10 : 5;
    const streak = opts.listening === "solid" ? 3 : 0;
    db.insert(progress)
      .values({ wordId: word.id, mode: "audio", direction: "listen", tested: n, correct: n, streak, lastTested })
      .run();
  }

  return word.id;
}

const ready = makeWord({ term: "ready", written: "solid", listening: "solid" });
const halfWritten = makeWord({ term: "half-written", written: "learnt", listening: "solid" });
const halfHeard = makeWord({ term: "half-heard", written: "solid", listening: "learnt" });
const neverHeard = makeWord({ term: "never-heard", written: "solid" });
const untouched = makeWord({ term: "untouched" });
const muted = makeWord({ term: "muted", written: "solid", audioEnabled: false });
const mutedUnlearnt = makeWord({ term: "muted-unlearnt", written: "learnt", audioEnabled: false });
const heardOnly = makeWord({ term: "heard-only", listening: "solid", writtenEnabled: false });
const inNeither = makeWord({ term: "in-neither", writtenEnabled: false, audioEnabled: false });
const optedOut = makeWord({
  term: "opted-out",
  written: "solid",
  listening: "solid",
  speakEnabled: false,
});

const pool = () => new Set(loadScoredWords(language.id, "speak").map((w) => w.wordId));

console.log("\nWhich words speaking offers\n");

let inPool = pool();

check("solid in both is in", inPool.has(ready));
check("only learnt in written is out", !inPool.has(halfWritten));
check("only learnt in listening is out", !inPool.has(halfHeard));
check("never practised is out", !inPool.has(untouched));
check("a muted word solid in written is in", inPool.has(muted));
check("a muted word not yet solid in written is out", !inPool.has(mutedUnlearnt));
check("kept out of written but solid in listening is in", inPool.has(heardOnly));
check("in neither mode is out", !inPool.has(inNeither));
check("the speaking opt-in still decides", !inPool.has(optedOut));
check("solid in written but never heard is out", !inPool.has(neverHeard));
check("so the pool is exactly those three", inPool.size === 3, `${inPool.size} words`);

const writtenCount = loadScoredWords(language.id, "written").length;
const audioCount = loadScoredWords(language.id, "audio").length;
check(
  "written is ungated, and listening has a gate of its own",
  writtenCount === 8 && audioCount === 6,
  `${writtenCount} written, ${audioCount} listening`,
);

/* ------------------------------------------------------------------
   The gate on listening
   ------------------------------------------------------------------ */

console.log("\nThe listening rule\n");

check("answered in written is ready", isListeningReady({ inWritten: true, writtenAnswers: 1 }));
check("never answered is not", !isListeningReady({ inWritten: true, writtenAnswers: 0 }));
check(
  "a word kept out of written is let through",
  isListeningReady({ inWritten: false, writtenAnswers: 0 }),
);

console.log("\nWhich words listening offers\n");

const heard = () => new Set(loadScoredWords(language.id, "audio").map((w) => w.wordId));
let inHeard = heard();

check("answered in written is in", inHeard.has(ready));
check("only learnt in written is still in", inHeard.has(halfWritten));
check("solid in written but never heard is in", inHeard.has(neverHeard));
check("never answered in written is out", !inHeard.has(untouched));
check("kept out of written is let through", inHeard.has(heardOnly));
check("the listening opt-in still decides", !inHeard.has(muted));

// Neglect pulls a written score down for ever, but it cannot un-answer the
// question — so unlike speaking, this door only swings one way.
const fourHundredDaysAgo = new Date();
fourHundredDaysAgo.setDate(fourHundredDaysAgo.getDate() - 400);

db.update(progress)
  .set({ lastTested: today(fourHundredDaysAgo) })
  .where(and(eq(progress.wordId, halfWritten), eq(progress.mode, "written")))
  .run();

const decayed =
  loadScoredWords(language.id, "written").find((w) => w.wordId === halfWritten)?.score ?? 0;

check("written neglect can take a score below zero", decayed < 0, `${decayed}`);
check("but the word stays available to listening", heard().has(halfWritten));

/* ------------------------------------------------------------------
   The two gates composed
   ------------------------------------------------------------------ */

console.log("\nThe gates do not read each other\n");

// If readyToSpeak read the *gated* listening list, a word never heard would
// look like a word kept out of listening, and speaking would then judge it on
// written alone — letting it in on half the evidence.
check("a word solid in written but never heard is offered by listening", heard().has(neverHeard));
check("and withheld by speaking at the same time", !pool().has(neverHeard));
check("so the speaking pool is unmoved by the listening gate", pool().size === 3, `${pool().size} words`);

/* ------------------------------------------------------------------
   Falling back out, and coming back in
   ------------------------------------------------------------------ */

console.log("\nFalling out of the pool keeps the speaking record\n");

// Thirty days of speaking neglect: four right answers on a streak is 2.9
// fresh, so 2.6 by now. The exact figure is what has to survive the trip out.
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

db.insert(progress)
  .values({
    wordId: ready,
    mode: "speak",
    direction: "say",
    tested: 4,
    correct: 4,
    streak: 3,
    lastTested: today(thirtyDaysAgo),
  })
  .run();

const scoreInPool = (wordId: number) =>
  loadScoredWords(language.id, "speak").find((w) => w.wordId === wordId)?.score ?? null;

check("its speaking score reflects its answers", scoreInPool(ready) === 2.6, `${scoreInPool(ready)}`);

// Now let the written side decay: a hundred days of neglect costs 1.0, which
// takes 3.5 to 2.5 — still learnt, no longer solid.
const hundredDaysAgo = new Date();
hundredDaysAgo.setDate(hundredDaysAgo.getDate() - 100);

db.update(progress)
  .set({ lastTested: today(hundredDaysAgo) })
  .where(and(eq(progress.wordId, ready), eq(progress.mode, "written")))
  .run();

inPool = pool();
check("a word that drops below solid leaves the pool", !inPool.has(ready));
check("and the pool is down to two", inPool.size === 2, `${inPool.size} words`);

const kept = db
  .select()
  .from(progress)
  .where(and(eq(progress.wordId, ready), eq(progress.mode, "speak")))
  .all();

check(
  "its speaking row is untouched",
  kept.length === 1 && kept[0]!.tested === 4 && kept[0]!.correct === 4 && kept[0]!.streak === 3,
  JSON.stringify(kept[0] ?? null),
);

// Bring the written side back, as a session would.
db.update(progress)
  .set({ lastTested: today() })
  .where(and(eq(progress.wordId, ready), eq(progress.mode, "written")))
  .run();

inPool = pool();
check("it comes back in when written is solid again", inPool.has(ready));
check(
  "with the score it left on, neglect and all",
  scoreInPool(ready) === 2.6,
  `${scoreInPool(ready)} — not 0, and not reset`,
);

/* ------------------------------------------------------------------ */

if (failures === 0) console.log("\nEach mode is asked only of the words it is ready for.\n");
else console.log(`\n${failures} problem(s).\n`);

// Windows will not delete the file while the handle is open, and a stray
// temp directory is not worth failing a passing suite over.
sqlite.close();
try {
  rmSync(workspace, { recursive: true, force: true });
} catch {
  console.log(`  (left ${workspace} behind)`);
}

process.exit(failures > 0 ? 1 : 0);
