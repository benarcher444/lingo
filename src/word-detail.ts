import { and, asc, eq } from "drizzle-orm";

import {
  COMPLETELY_LEARNT_THRESHOLD,
  LEARNT_THRESHOLD,
  MODE_DIRECTIONS,
  STREAK_TARGET,
  accuracy,
  explainScore,
  scoreWord,
  today,
  type Direction,
  type Mode,
  type ScoreBreakdown,
  type WordProgress,
} from "./algorithm.js";
import { db } from "./db/index.js";
import { attempts, languages, progress, wordTypes, words } from "./db/schema.js";

export interface DirectionStats {
  direction: Direction;
  tested: number;
  correct: number;
  wrong: number;
  accuracy: number;
  streak: number;
  lastTested: string | null;
}

export interface ModeStats {
  mode: Mode;
  enabled: boolean;
  score: number;
  breakdown: ScoreBreakdown;
  directions: DirectionStats[];
  totalTested: number;
  totalCorrect: number;
  lastTested: string | null;
}

export interface AttemptRow {
  direction: Direction;
  mode: Mode;
  correct: boolean;
  overridden: boolean;
  givenAnswer: string | null;
  answeredAt: string;
}

export interface WordDetail {
  id: number;
  term: string;
  english: string;
  notes: string | null;
  wordTypeName: string;
  languageName: string;
  createdAt: string;
  writtenEnabled: boolean;
  audioEnabled: boolean;
  modes: ModeStats[];
  recentAttempts: AttemptRow[];
  /** Score after each answer, plus a final point for today. */
  scoreHistory: { x: number; y: number }[];
}

/** Loads everything known about one word. Returns null if it is not the user's. */
export function loadWordDetail(userId: number, wordId: number): WordDetail | null {
  const row = db
    .select({
      id: words.id,
      term: words.term,
      english: words.english,
      notes: words.notes,
      createdAt: words.createdAt,
      writtenEnabled: words.writtenEnabled,
      audioEnabled: words.audioEnabled,
      wordTypeName: wordTypes.name,
      languageName: languages.name,
    })
    .from(words)
    .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
    .innerJoin(languages, eq(languages.id, wordTypes.languageId))
    .where(and(eq(words.id, wordId), eq(languages.userId, userId)))
    .get();

  if (!row) return null;

  const progressRows = db
    .select()
    .from(progress)
    .where(eq(progress.wordId, wordId))
    .all();

  const attemptRows = db
    .select()
    .from(attempts)
    .where(eq(attempts.wordId, wordId))
    .orderBy(asc(attempts.answeredAt))
    .all();

  const modes: ModeStats[] = (["written", "audio"] as Mode[]).map((mode) => {
    const forMode = progressRows.filter((p) => p.mode === mode);

    let lastTested: string | null = null;
    for (const p of forMode) {
      if (p.lastTested && (!lastTested || p.lastTested > lastTested)) lastTested = p.lastTested;
    }

    const directions: DirectionStats[] = MODE_DIRECTIONS[mode].map((direction) => {
      const p = forMode.find((entry) => entry.direction === direction);
      const tested = p?.tested ?? 0;
      const correct = p?.correct ?? 0;

      return {
        direction,
        tested,
        correct,
        wrong: tested - correct,
        accuracy: accuracy(correct, tested),
        streak: p?.streak ?? 0,
        lastTested: p?.lastTested ?? null,
      };
    });

    const wordProgress: WordProgress = {
      directions: directions.map((d) => ({
        direction: d.direction,
        tested: d.tested,
        correct: d.correct,
        streak: d.streak,
      })),
      lastTested,
    };

    return {
      mode,
      enabled: mode === "audio" ? row.audioEnabled : row.writtenEnabled,
      score: scoreWord(wordProgress, mode),
      breakdown: explainScore(wordProgress, mode),
      directions,
      totalTested: directions.reduce((sum, d) => sum + d.tested, 0),
      totalCorrect: directions.reduce((sum, d) => sum + d.correct, 0),
      lastTested,
    };
  });

  return {
    ...row,
    modes,
    recentAttempts: [...attemptRows]
      .reverse()
      .slice(0, 20)
      .map((a) => ({
        direction: a.direction as Direction,
        mode: a.mode as Mode,
        correct: a.correct,
        overridden: a.overridden,
        givenAnswer: a.givenAnswer,
        answeredAt: a.answeredAt,
      })),
    scoreHistory: replayScore(attemptRows, "written"),
  };
}

/**
 * Reconstructs the written score after each answer by replaying the attempt
 * log — which is exactly what storing one row per answer was for.
 *
 * At the moment of an answer the word has just been tested, so the neglect term
 * is zero; the decay between points is what the line shows as it falls. A final
 * point for today carries the real neglect, so the last segment slopes down if
 * the word has been left alone.
 */
function replayScore(
  rows: (typeof attempts.$inferSelect)[],
  mode: Mode,
): { x: number; y: number }[] {
  const relevant = rows.filter((r) => r.mode === mode);
  if (relevant.length === 0) return [];

  const state = new Map<Direction, { tested: number; correct: number; streak: number }>();
  const points: { x: number; y: number }[] = [];

  for (const attempt of relevant) {
    const direction = attempt.direction as Direction;
    const current = state.get(direction) ?? { tested: 0, correct: 0, streak: 0 };

    current.tested += 1;
    if (attempt.correct) {
      current.correct += 1;
      current.streak = Math.min(STREAK_TARGET, current.streak + 1);
    } else {
      current.streak = 0;
    }
    state.set(direction, current);

    const stamp = attempt.answeredAt.slice(0, 10);

    points.push({
      x: Date.parse(attempt.answeredAt),
      y: scoreWord(
        {
          directions: [...state.entries()].map(([d, s]) => ({ direction: d, ...s })),
          // Just tested, so no decay has accrued at this instant.
          lastTested: stamp,
        },
        mode,
      ),
    });
  }

  // Where the score sits now, decay included.
  const last = relevant[relevant.length - 1]!;
  points.push({
    x: Date.now(),
    y: scoreWord(
      {
        directions: [...state.entries()].map(([d, s]) => ({ direction: d, ...s })),
        lastTested: last.answeredAt.slice(0, 10),
      },
      mode,
    ),
  });

  return points;
}

export { LEARNT_THRESHOLD, COMPLETELY_LEARNT_THRESHOLD, today };
