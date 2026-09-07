/**
 * Checks on the scoring algorithm — the one piece of logic where a silent
 * mistake would quietly corrupt months of learning history.
 *
 *   npm test
 */

import {
  answersMatch,
  daysBetween,
  scoreWord,
  selectionOdds,
  weightedSample,
  type WordProgress,
} from "../src/algorithm.js";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}\n         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const today = new Date().toISOString().slice(0, 10);

function written(
  tested: number,
  correct: number,
  streak: number,
  lastTested: string | null,
): WordProgress {
  return {
    directions: [
      { direction: "to_english", tested, correct, streak },
      { direction: "from_english", tested, correct, streak },
    ],
    lastTested,
  };
}

console.log("\nAnswer matching");
check("plain match", answersMatch("the dog", "the dog"), true);
check("case insensitive", answersMatch("The Dog", "the dog"), true);
check("collapses spaces", answersMatch("  the   dog ", "the dog"), true);
check("accepts unaccented etre for être", answersMatch("etre", "être"), true);
check("accepts ca for ça", answersMatch("ca va", "ça va"), true);
check("accepts coeur for cœur", answersMatch("coeur", "cœur"), true);
check("accepts straight for curly apostrophe", answersMatch("l'eau", "l’eau"), true);
check("accepts n for ñ", answersMatch("manana", "mañana"), true);
check("still rejects a wrong answer", answersMatch("cat", "the dog"), false);

console.log("\nScoring");
check("never-tested word scores 0", scoreWord({ directions: [], lastTested: null }, "written"), 0);
check(
  "perfect word tested today = 1 + 1 + 0.5 + 0.5 + 0.5 streak",
  scoreWord(written(10, 10, 3, today), "written"),
  3.5,
);
check(
  "streak bonus needs BOTH directions at 3",
  scoreWord(
    {
      directions: [
        { direction: "to_english", tested: 10, correct: 10, streak: 3 },
        { direction: "from_english", tested: 10, correct: 10, streak: 2 },
      ],
      lastTested: today,
    },
    "written",
  ),
  3,
);
check(
  "neglect subtracts 0.01/day",
  scoreWord(written(10, 10, 3, daysAgo(100)), "written"),
  2.5,
);
check(
  "audio: accuracy*2/100 + correct/10 + streak",
  scoreWord(
    { directions: [{ direction: "listen", tested: 3, correct: 3, streak: 3 }], lastTested: today },
    "audio",
  ),
  2.8,
);

console.log("\nDecay crosses the learnt threshold");
{
  // 6 correct in each direction with a full streak scores 3.1, so it takes
  // ~80 days of neglect to fall back under the 2.3 line.
  const fresh = scoreWord(written(6, 6, 3, today), "written");
  const at60 = scoreWord(written(6, 6, 3, daysAgo(60)), "written");
  const at90 = scoreWord(written(6, 6, 3, daysAgo(90)), "written");
  check("fresh word is learnt", fresh > 2.3, true);
  check("still learnt after 60 days", at60 > 2.3, true);
  check("no longer learnt after 90 days", at90 > 2.3, false);
  check("a word practised more survives longer", scoreWord(written(20, 20, 3, daysAgo(90)), "written") > 2.3, true);
}

console.log("\nSelection weighting");
check("unseen word gets the maximum weight", selectionOdds(0), 50);
check("weight is flat below 0.6", selectionOdds(0.5), 50);
check("a learnt word is rare but reachable", selectionOdds(2.3), 1);
check("never returns 0 (the original could)", selectionOdds(99), 1);

console.log("\nSampling");
{
  const pool = [1, 2, 3, 4, 5];
  const picked = weightedSample(pool, 3, () => 1);
  check("returns the requested count", picked.length, 3);
  check("without replacement", new Set(picked).size, 3);
  check("count 0 means everything", weightedSample(pool, 0, () => 1).length, 5);
  check("count above pool size returns pool", weightedSample(pool, 99, () => 1).length, 5);
}

console.log("\nDates");
check("daysBetween counts forward", daysBetween("2026-01-01", "2026-01-11"), 10);
check("daysBetween handles month ends", daysBetween("2026-01-31", "2026-02-01"), 1);

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
