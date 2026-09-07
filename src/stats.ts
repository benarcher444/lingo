import { and, eq } from "drizzle-orm";

import { db } from "./db/index.js";
import { progress, statSnapshots, wordTypes, words } from "./db/schema.js";
import {
  MODE_DIRECTIONS,
  isCompletelyLearnt,
  isLearnt,
  scoreWord,
  type Direction,
  type DirectionProgress,
  type Mode,
  type WordProgress,
} from "./algorithm.js";

export interface ScoredWord {
  wordId: number;
  wordTypeId: number;
  wordTypeName: string;
  term: string;
  english: string;
  score: number;
  lastTested: string | null;
  directions: Record<Direction, DirectionProgress>;
}

/**
 * Load every word for a language in one query, with its progress rows, and
 * score it in TypeScript.
 *
 * Scoring in memory rather than SQL is a deliberate call: the score depends on
 * today's date, so any stored value is stale the next morning. At a few
 * thousand words per language this costs under a millisecond.
 */
export function loadScoredWords(languageId: number, mode: Mode): ScoredWord[] {
  const enabledColumn = mode === "audio" ? words.audioEnabled : words.writtenEnabled;

  const rows = db
    .select({
      wordId: words.id,
      wordTypeId: words.wordTypeId,
      wordTypeName: wordTypes.name,
      term: words.term,
      english: words.english,
      direction: progress.direction,
      tested: progress.tested,
      correct: progress.correct,
      streak: progress.streak,
      lastTested: progress.lastTested,
    })
    .from(words)
    .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
    .leftJoin(
      progress,
      and(eq(progress.wordId, words.id), eq(progress.mode, mode)),
    )
    .where(and(eq(wordTypes.languageId, languageId), eq(enabledColumn, true)))
    .all();

  const byWord = new Map<number, ScoredWord>();

  for (const row of rows) {
    let entry = byWord.get(row.wordId);

    if (!entry) {
      entry = {
        wordId: row.wordId,
        wordTypeId: row.wordTypeId,
        wordTypeName: row.wordTypeName,
        term: row.term,
        english: row.english,
        score: 0,
        lastTested: null,
        directions: {} as Record<Direction, DirectionProgress>,
      };
      byWord.set(row.wordId, entry);
    }

    if (row.direction) {
      entry.directions[row.direction as Direction] = {
        direction: row.direction as Direction,
        tested: row.tested ?? 0,
        correct: row.correct ?? 0,
        streak: row.streak ?? 0,
      };
      // The newest lastTested across directions is the word's lastTested.
      if (row.lastTested && (!entry.lastTested || row.lastTested > entry.lastTested)) {
        entry.lastTested = row.lastTested;
      }
    }
  }

  for (const entry of byWord.values()) {
    const wordProgress: WordProgress = {
      directions: Object.values(entry.directions),
      lastTested: entry.lastTested,
    };
    entry.score = scoreWord(wordProgress, mode);
  }

  return [...byWord.values()];
}

/**
 * The four count fields form a true partition of `total`:
 *
 *   completelyLearnt + learntNotSolid + inProgress + untouched === total
 *
 * `learnt` is the inclusive figure (solid words included) used for the headline
 * and percentages. Showing `completelyLearnt` next to `inProgress` without
 * `learntNotSolid` made the tiles appear not to add up, because a word sitting
 * between the two thresholds belonged to neither.
 */
export interface Summary {
  total: number;
  /** score > 2.3, including solid words. */
  learnt: number;
  /** score > 2.556. */
  completelyLearnt: number;
  /** Above the learnt line but not yet solid. */
  learntNotSolid: number;
  /** Practised at least once, still below the learnt line. */
  inProgress: number;
  /** Never tested in this mode. */
  untouched: number;
  pctLearnt: number;
  pctCompletelyLearnt: number;
  averageScore: number;
  averageAccuracy: number;
  staleDays: number;
}

export function summarise(rows: ScoredWord[], mode: Mode): Summary {
  const total = rows.length;
  if (total === 0) {
    return {
      total: 0,
      learnt: 0,
      completelyLearnt: 0,
      learntNotSolid: 0,
      inProgress: 0,
      untouched: 0,
      pctLearnt: 0,
      pctCompletelyLearnt: 0,
      averageScore: 0,
      averageAccuracy: 0,
      staleDays: 0,
    };
  }

  let learnt = 0;
  let completelyLearnt = 0;
  let untouched = 0;
  let scoreSum = 0;
  let accuracySum = 0;
  let accuracyCount = 0;
  let staleDays = 0;

  const directions = MODE_DIRECTIONS[mode];
  const todayMs = Date.now();

  for (const row of rows) {
    scoreSum += row.score;
    if (isLearnt(row.score)) learnt += 1;
    if (isCompletelyLearnt(row.score)) completelyLearnt += 1;

    let tested = 0;
    let correct = 0;
    for (const d of directions) {
      const dp = row.directions[d];
      if (dp) {
        tested += dp.tested;
        correct += dp.correct;
      }
    }

    if (tested === 0) {
      untouched += 1;
    } else {
      accuracySum += (100 * correct) / tested;
      accuracyCount += 1;
    }

    if (row.lastTested) {
      const days = Math.floor(
        (todayMs - Date.parse(`${row.lastTested}T00:00:00Z`)) / 86_400_000,
      );
      if (days > staleDays) staleDays = days;
    }
  }

  return {
    total,
    learnt,
    completelyLearnt,
    learntNotSolid: learnt - completelyLearnt,
    inProgress: total - learnt - untouched,
    untouched,
    pctLearnt: round2((100 * learnt) / total),
    pctCompletelyLearnt: round2((100 * completelyLearnt) / total),
    averageScore: round2(scoreSum / total),
    averageAccuracy: accuracyCount > 0 ? round2(accuracySum / accuracyCount) : 0,
    staleDays,
  };
}

export interface TypeSummary extends Summary {
  wordTypeId: number;
  wordTypeName: string;
}

export function summariseByType(rows: ScoredWord[], mode: Mode): TypeSummary[] {
  const groups = new Map<number, { name: string; rows: ScoredWord[] }>();

  for (const row of rows) {
    let group = groups.get(row.wordTypeId);
    if (!group) {
      group = { name: row.wordTypeName, rows: [] };
      groups.set(row.wordTypeId, group);
    }
    group.rows.push(row);
  }

  return [...groups.entries()]
    .map(([wordTypeId, group]) => ({
      wordTypeId,
      wordTypeName: group.name,
      ...summarise(group.rows, mode),
    }))
    .sort((a, b) => a.wordTypeName.localeCompare(b.wordTypeName));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Append a statistics snapshot. Called at the START and the END of a session —
 * the original only recorded the start, so its history never showed the effect
 * of the work just done.
 */
export function recordSnapshot(languageId: number, mode: Mode): void {
  const rows = loadScoredWords(languageId, mode);
  if (rows.length === 0) return;

  const takenAt = new Date().toISOString();
  const entries: (typeof statSnapshots.$inferInsert)[] = [];

  const push = (wordTypeId: number | null, summary: Summary) => {
    const measures: Record<string, number> = {
      total_words: summary.total,
      words_learnt: summary.learnt,
      words_learnt_not_solid: summary.learntNotSolid,
      words_learning: summary.inProgress,
      words_completely_learnt: summary.completelyLearnt,
      percentage_learnt: summary.pctLearnt,
      percentage_completely_learnt: summary.pctCompletelyLearnt,
      average_score: summary.averageScore,
      average_accuracy: summary.averageAccuracy,
      new_words: summary.untouched,
      highest_days_since_last_tested: summary.staleDays,
    };

    for (const [measure, value] of Object.entries(measures)) {
      entries.push({ languageId, wordTypeId, mode, takenAt, measure, value });
    }
  };

  push(null, summarise(rows, mode));
  for (const type of summariseByType(rows, mode)) {
    push(type.wordTypeId, type);
  }

  db.insert(statSnapshots).values(entries).run();
}
