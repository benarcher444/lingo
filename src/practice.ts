import { and, asc, desc, eq } from "drizzle-orm";

import {
  MODE_DIRECTIONS,
  answersMatch,
  scoreWord,
  selectionOdds,
  tallyAnswers,
  today,
  weightedSample,
  type Direction,
  type Mode,
} from "./algorithm.js";
import { db } from "./db/index.js";
import { attempts, languages, progress, wordTypes, words } from "./db/schema.js";
import { loadScoredWords, type ScoredWord } from "./stats.js";

export interface PracticeCard {
  wordId: number;
  term: string;
  english: string;
  wordType: string;
  score: number;
  /** Directions still to be answered correctly this session. */
  pending: Direction[];
}

/**
 * Build a session queue: sample words by the exponential-odds weighting, then
 * expand each into the directions the mode requires.
 *
 * `count` of 0 means "everything", matching the original's blank-for-all.
 */
export function buildSession(opts: {
  languageId: number;
  mode: Mode;
  wordTypeId?: number | null;
  count: number;
}): PracticeCard[] {
  let pool: ScoredWord[] = loadScoredWords(opts.languageId, opts.mode);

  if (opts.wordTypeId) {
    pool = pool.filter((w) => w.wordTypeId === opts.wordTypeId);
  }

  const picked = weightedSample(pool, opts.count, (word) => selectionOdds(word.score));

  return picked.map((word) => ({
    wordId: word.wordId,
    term: word.term,
    english: word.english,
    wordType: word.wordTypeName,
    score: word.score,
    pending: [...MODE_DIRECTIONS[opts.mode]],
  }));
}

export interface AnswerResult {
  correct: boolean;
  expected: string;
  score: number;
  previousScore: number;
  streak: number;
  justLearnt: boolean;
}

/**
 * Judge and record one answer. Comparison happens here rather than in the
 * browser so the rule is single-sourced and cannot be bypassed from devtools.
 */
export function recordAnswer(opts: {
  userId: number;
  wordId: number;
  mode: Mode;
  direction: Direction;
  given: string;
  /** "I was right": marks the miss just recorded as correct. Adds no answer. */
  override?: boolean;
  /** Groups answers into one practice session. See attempts.sessionId. */
  sessionId?: string | null;
}): AnswerResult | null {
  const word = db
    .select({
      id: words.id,
      term: words.term,
      english: words.english,
      languageId: wordTypes.languageId,
    })
    .from(words)
    .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
    .innerJoin(languages, eq(languages.id, wordTypes.languageId))
    .where(and(eq(words.id, opts.wordId), eq(languages.userId, opts.userId)))
    .get();

  if (!word) return null;

  // Only "from_english" asks for the target language. Listening plays the
  // target-language word and asks what it means, so it wants the English —
  // that tests comprehension rather than spelling back what you just heard.
  const expected = opts.direction === "from_english" ? word.term : word.english;
  const graded = opts.override === true || answersMatch(opts.given, expected);
  const previousScore = currentScore(opts.wordId, opts.mode);

  const sameCard = and(
    eq(attempts.wordId, opts.wordId),
    eq(attempts.mode, opts.mode),
    eq(attempts.direction, opts.direction),
  );

  db.transaction(() => {
    if (opts.override === true) {
      // "I was right — count it" corrects the miss just recorded. It is not an
      // answer of its own: it once added a second, correct row and kept the
      // miss, so one question counted as tested twice, wrong once, right once.
      const last = db.select().from(attempts).where(sameCard).orderBy(desc(attempts.id)).get();
      const correctable = last && !last.correct && last.sessionId === (opts.sessionId ?? null);

      // Nothing to correct — a second press, or a page left open — changes nothing.
      if (!correctable) return;

      db.update(attempts)
        .set({ correct: true, overridden: true })
        .where(eq(attempts.id, last.id))
        .run();
    } else {
      db.insert(attempts)
        .values({
          wordId: opts.wordId,
          mode: opts.mode,
          direction: opts.direction,
          correct: graded,
          givenAnswer: opts.given.slice(0, 200),
          sessionId: opts.sessionId ?? null,
        })
        .run();
    }

    rebuildProgress(opts.wordId, opts.mode, opts.direction);
  });

  const score = currentScore(opts.wordId, opts.mode);
  const streakRow = db
    .select({ streak: progress.streak })
    .from(progress)
    .where(
      and(
        eq(progress.wordId, opts.wordId),
        eq(progress.mode, opts.mode),
        eq(progress.direction, opts.direction),
      ),
    )
    .get();

  return {
    correct: graded,
    expected,
    score,
    previousScore,
    streak: streakRow?.streak ?? 0,
    justLearnt: previousScore <= 2.3 && score > 2.3,
  };
}

/**
 * Rebuild one progress row from the answers behind it, rather than adding to
 * it, so the counts are always exactly what the answers say. See tallyAnswers.
 */
function rebuildProgress(wordId: number, mode: Mode, direction: Direction): void {
  const results = db
    .select({ correct: attempts.correct })
    .from(attempts)
    .where(
      and(eq(attempts.wordId, wordId), eq(attempts.mode, mode), eq(attempts.direction, direction)),
    )
    .orderBy(asc(attempts.id))
    .all()
    .map((row) => row.correct);

  const counts = { ...tallyAnswers(results), lastTested: today() };

  db.insert(progress)
    .values({ wordId, mode, direction, ...counts })
    .onConflictDoUpdate({
      target: [progress.wordId, progress.mode, progress.direction],
      set: counts,
    })
    .run();
}

/** Recompute one word's score for a mode from its stored direction rows. */
function currentScore(wordId: number, mode: Mode): number {
  const rows = db
    .select()
    .from(progress)
    .where(and(eq(progress.wordId, wordId), eq(progress.mode, mode)))
    .all();

  if (rows.length === 0) return 0;

  let lastTested: string | null = null;
  for (const row of rows) {
    if (row.lastTested && (!lastTested || row.lastTested > lastTested)) {
      lastTested = row.lastTested;
    }
  }

  return scoreWord(
    {
      directions: rows.map((row) => ({
        direction: row.direction as Direction,
        tested: row.tested,
        correct: row.correct,
        streak: row.streak,
      })),
      lastTested,
    },
    mode,
  );
}
