/**
 * Translation practice: the AI builds a sentence out of words you already have,
 * shows it in English, and marks what you write back in the target language.
 *
 * Why it is built on your own vocabulary: a sentence made of words you have met
 * stays at the level you are actually at, and practises recall of those words in
 * context rather than in isolation.
 *
 * It never touches scores. A sentence you get wrong is not the same as a word
 * you cannot recall, and mixing the two would corrupt the figures the written
 * and listening modes keep. The owner asked for that explicitly (2026-10-06).
 */

import { randomUUID } from "node:crypto";

import { selectionOdds, weightedSample } from "./algorithm.js";
import { levelBrief, type Level } from "./chat-scenarios.js";
import { loadScoredWords, type ScoredWord } from "./stats.js";

/** Which words a round draws on. */
export type Weighting = "due" | "any";

export interface RoundWord {
  term: string;
  english: string;
}

export interface Round {
  id: string;
  userId: number;
  languageId: number;
  languageName: string;
  level: Level;
  words: RoundWord[];
  /** What the learner translates. */
  english: string;
  /** The composer's own sentence, kept here until the round is marked. */
  target: string;
  createdAt: number;
}

/**
 * Rounds in flight, in memory like the sign-in limiter. The model answer stays
 * here rather than going to the page, or it would sit in the browser while the
 * learner is still writing. Lost on restart, which costs one round.
 */
const rounds = new Map<string, Round>();
const ROUND_TTL_MS = 2 * 60 * 60 * 1000;

export function keepRound(round: Omit<Round, "id" | "createdAt">): Round {
  for (const [id, old] of rounds) {
    if (Date.now() - old.createdAt > ROUND_TTL_MS) rounds.delete(id);
  }
  const full: Round = { ...round, id: randomUUID(), createdAt: Date.now() };
  rounds.set(full.id, full);
  return full;
}

/** The round, if it is this user's and still in flight. */
export function findRound(id: string, userId: number): Round | undefined {
  const round = rounds.get(id);
  if (!round || round.userId !== userId) return undefined;
  if (Date.now() - round.createdAt > ROUND_TTL_MS) {
    rounds.delete(id);
    return undefined;
  }
  return round;
}

export function dropRound(id: string): void {
  rounds.delete(id);
}

/**
 * The words a round is built from.
 *
 * "due" uses the same weighting as practice, so solid words are left out and
 * the shaky ones come up — the sentence then drills what needs drilling.
 * "any" is a flat draw across the whole vocabulary, for variety.
 */
export function pickWords(languageId: number, count: number, weighting: Weighting): ScoredWord[] {
  const pool = loadScoredWords(languageId, "written");
  if (pool.length === 0) return [];

  const wanted = Math.min(count, pool.length);
  if (weighting === "due") return weightedSample(pool, wanted, (word) => selectionOdds(word.score));

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, wanted);
}

/* ------------------------------------------------------------------
   Prompts
   ------------------------------------------------------------------ */

export function composerPrompt(language: string, level: Level): string {
  return `You write short translation exercises for a learner of ${language} at level ${level}.

You are given words the learner already knows. Write one to three short sentences in
${language} using every one of them — something a real person might actually say.

How to use the words:
- In any order. The order they are listed in means nothing; rearrange them freely.
- In whatever form the grammar needs: conjugate verbs, agree adjectives, make nouns
  plural, add articles and prepositions.
- Each word must modify something it sensibly modifies. A colour describes a thing,
  not a conversation; a feeling describes a person, not an action.
- If the words do not sit together naturally, do NOT force them into one sentence.
  Write two or three sentences that add up to a small scene instead, joined by "and",
  "but", "because", or simply one after another.

Naturalness comes first. A sentence no one would ever say is a failed exercise, even
if every word is in it. Prefer three plain sentences that make sense to one clever
sentence that does not.

${levelBrief(level)}

Then translate what you wrote into natural English — what a native English speaker
would say, not a word-by-word rendering.

Reply with JSON and nothing else, no code fence:
{"target": "<your ${language} sentence>", "english": "<its English translation>"}`;
}

export function markerPrompt(language: string, level: Level): string {
  return `You mark a learner's translation into ${language}. They are at level ${level}.

You are given the English they were asked to translate, a model answer in ${language},
and what they wrote. Mark what they wrote on its own merits: different wording that
means the same thing and is correct ${language} is right, even where it differs from
the model answer.

Judge:
- "right" — correct ${language} that conveys the English.
- "close" — understandable and nearly there, with small slips (agreement, a wrong
  preposition, word order that is odd but clear).
- "wrong" — it does not convey the English, or it could not be understood.

A missing accent or a missing capital is a slip worth mentioning, never enough on
its own to drop the verdict below "right".

Ignore punctuation completely. Quotation marks, apostrophes, question and
exclamation marks, commas and full stops are never a mistake, present or absent,
and are not worth a note.

For each real mistake, give what they wrote, what it should be, and one short
reason a learner would understand. At most four, the most useful first. Say nothing
about things they got right.

Reply with JSON and nothing else, no code fence:
{"verdict": "right|close|wrong",
 "comment": "<one encouraging line, under 20 words>",
 "corrected": "<their sentence, repaired as lightly as possible>",
 "notes": [{"wrote": "<their words>", "better": "<the fix>", "why": "<short reason>"}]}`;
}

/** The words, as the composer is given them. */
export function wordList(words: RoundWord[]): string {
  return words.map((w) => `- ${w.term} (${w.english})`).join("\n");
}

/* ------------------------------------------------------------------
   Reading the AI's answer
   ------------------------------------------------------------------ */

/**
 * Models wrap JSON in a code fence however firmly you ask them not to, so take
 * the outermost braces rather than trusting the whole string to parse.
 */
export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
