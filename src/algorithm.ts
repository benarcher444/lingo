/**
 * The scoring algorithm, ported from the original terminal app (old_code_repo/algorithm.py).
 *
 * A word carries one score per mode, built from three additive parts:
 *
 *   score = accuracy + streak - neglect
 *
 * The neglect term is negative and grows with time since the last test, so a
 * word drifts back below the "learnt" line if it is left alone. That decay is
 * what makes the completion percentage a live number rather than a ratchet, and
 * it is the reason score is DERIVED here rather than stored: a cached column
 * would silently go stale as the calendar moves.
 */

export const LEARNT_THRESHOLD = 2.3;
export const COMPLETELY_LEARNT_THRESHOLD = 2.556;

/** Streak value at which the bonus lands. Matches the original's 3-in-a-row. */
export const STREAK_TARGET = 3;

export type Mode = "written" | "audio";
export type Direction = "to_english" | "from_english" | "listen";

/** Directions that make up a session for each mode. */
export const MODE_DIRECTIONS: Record<Mode, Direction[]> = {
  written: ["to_english", "from_english"],
  audio: ["listen"],
};

export interface DirectionProgress {
  direction: Direction;
  tested: number;
  correct: number;
  streak: number;
}

export interface WordProgress {
  /** One entry per direction relevant to the mode. Missing = never tested. */
  directions: DirectionProgress[];
  /** ISO date (YYYY-MM-DD) of the last test, or null if never tested. */
  lastTested: string | null;
}

const MS_PER_DAY = 86_400_000;

/** Today as YYYY-MM-DD in local time (not UTC — the learner's day is what matters). */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whole days between two YYYY-MM-DD dates. Parsed at UTC midnight so daylight
 * saving cannot round a boundary the wrong way.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Days since a word was last tested. A word that has never been tested returns
 * 0, not a sentinel — the original returned 10000 here, which added +100 to the
 * score and would have rocketed untested words to the top of the "learnt" list.
 */
export function daysSinceTested(lastTested: string | null, now?: Date): number {
  if (!lastTested) return 0;
  const days = daysBetween(lastTested, today(now));
  return days > 0 ? days : 0;
}

export function accuracy(correct: number, tested: number): number {
  return tested > 0 ? (100 * correct) / tested : 0;
}

function direction(progress: WordProgress, wanted: Direction): DirectionProgress {
  return (
    progress.directions.find((d) => d.direction === wanted) ?? {
      direction: wanted,
      tested: 0,
      correct: 0,
      streak: 0,
    }
  );
}

/**
 * Score for one word in one mode. Never-tested words score 0, which gives them
 * the maximum selection weight below.
 */
export function scoreWord(progress: WordProgress, mode: Mode, now?: Date): number {
  const neglect = daysSinceTested(progress.lastTested, now) / 100;

  if (mode === "audio") {
    const listen = direction(progress, "listen");
    const acc = accuracy(listen.correct, listen.tested);
    const accuracyPart = (acc * 2) / 100 + listen.correct / 10;
    const streakPart = listen.streak >= STREAK_TARGET ? 0.5 : 0;
    return round(accuracyPart + streakPart - neglect);
  }

  const to = direction(progress, "to_english");
  const from = direction(progress, "from_english");
  const accuracyPart =
    accuracy(to.correct, to.tested) / 100 +
    accuracy(from.correct, from.tested) / 100 +
    to.correct / 20 +
    from.correct / 20;
  const streakPart =
    to.streak >= STREAK_TARGET && from.streak >= STREAK_TARGET ? 0.5 : 0;

  return round(accuracyPart + streakPart - neglect);
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface ScoreBreakdown {
  accuracy: number;
  volume: number;
  streak: number;
  neglect: number;
  total: number;
  daysSinceTested: number;
}

/**
 * The same score, itemised — so a word's number can be explained rather than
 * just asserted. `neglect` is reported as the positive amount subtracted.
 */
export function explainScore(
  progress: WordProgress,
  mode: Mode,
  now?: Date,
): ScoreBreakdown {
  const days = daysSinceTested(progress.lastTested, now);
  const neglect = days / 100;

  if (mode === "audio") {
    const listen = direction(progress, "listen");
    const accuracyPart = (accuracy(listen.correct, listen.tested) * 2) / 100;
    const volumePart = listen.correct / 10;
    const streakPart = listen.streak >= STREAK_TARGET ? 0.5 : 0;

    return {
      accuracy: round(accuracyPart),
      volume: round(volumePart),
      streak: streakPart,
      neglect: round(neglect),
      total: round(accuracyPart + volumePart + streakPart - neglect),
      daysSinceTested: days,
    };
  }

  const to = direction(progress, "to_english");
  const from = direction(progress, "from_english");

  const accuracyPart =
    accuracy(to.correct, to.tested) / 100 + accuracy(from.correct, from.tested) / 100;
  const volumePart = to.correct / 20 + from.correct / 20;
  const streakPart =
    to.streak >= STREAK_TARGET && from.streak >= STREAK_TARGET ? 0.5 : 0;

  return {
    accuracy: round(accuracyPart),
    volume: round(volumePart),
    streak: streakPart,
    neglect: round(neglect),
    total: round(accuracyPart + volumePart + streakPart - neglect),
    daysSinceTested: days,
  };
}

export function isLearnt(score: number): boolean {
  return score > LEARNT_THRESHOLD;
}

export function isCompletelyLearnt(score: number): boolean {
  return score > COMPLETELY_LEARNT_THRESHOLD;
}

/**
 * Selection weight. Flat 50 at or below 0.6, then exponential decay, so a
 * learnt word is roughly 50x less likely to come up than an unseen one.
 *
 * Clamped to a floor of 1: the original let this reach 0, which made a
 * thoroughly-known word unreachable rather than merely rare.
 */
export function selectionOdds(score: number): number {
  return Math.max(1, Math.floor(50 * Math.exp(-2 * Math.max(0, score - 0.6))));
}

/**
 * Weighted sample without replacement. `count` of 0 (or >= the pool size)
 * returns everything, matching the original's "blank means all".
 */
export function weightedSample<T>(
  pool: T[],
  count: number,
  weight: (item: T) => number,
  random: () => number = Math.random,
): T[] {
  if (count <= 0 || count >= pool.length) return [...pool];

  const remaining = pool.map((item) => ({ item, weight: Math.max(1, weight(item)) }));
  const picked: T[] = [];

  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((sum, entry) => sum + entry.weight, 0);
    let target = random() * total;
    let index = remaining.length - 1;

    for (let i = 0; i < remaining.length; i += 1) {
      target -= remaining[i]!.weight;
      if (target <= 0) {
        index = i;
        break;
      }
    }

    picked.push(remaining[index]!.item);
    remaining.splice(index, 1);
  }

  return picked;
}

/**
 * Strip accents for answer comparison, so `etre` is accepted for `être`.
 * Unicode-normalised rather than the original's hand-written table, which
 * covered only the characters French and Spanish happened to need.
 */
export function deaccent(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "AE")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Normalise an answer for comparison: trimmed, lowercased, de-accented, single-spaced. */
export function normaliseAnswer(text: string): string {
  return deaccent(text).trim().toLowerCase().replace(/\s+/g, " ");
}

export function answersMatch(given: string, expected: string): boolean {
  return normaliseAnswer(given) === normaliseAnswer(expected);
}
