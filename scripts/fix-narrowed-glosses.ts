/**
 * Gives twelve Spanish words their real meaning back.
 *
 *   npx tsx scripts/fix-narrowed-glosses.ts --email=you@example.com
 *   npx tsx scripts/fix-narrowed-glosses.ts --email=you@example.com --apply
 *
 * Several batches up to 2026-11-15 narrowed a word's English, or dropped the
 * word, whenever another entry already answered that meaning. The owner stopped
 * it on 2026-11-15: *"don't put something as something else just because that
 * word is taken … You do know synonyms exist in all languages? That doesn't
 * mean we shouldn't learn them?"* They are right, and a wrong meaning taught is
 * worse than the ambiguity it was avoiding. The rule now lives in CLAUDE.md
 * under "Duplicate words", and `lib/word-batch.ts` enforces it.
 *
 * This script is the repair. It only rewrites English, so nothing a word has
 * earned is touched — every answer, score and streak behind these twelve stays
 * exactly as it is, which is what makes a renote safe on a word with history
 * where a withdrawal would not be.
 *
 * **Seven of them never needed anything but their meaning back.** The duplicate
 * check compares the **card face** — the English as written — and the faces
 * never collided. They were narrowed against a stricter pre-check of mine that
 * compared every lenient *reading*, which is not the problem the guard exists
 * for: 62 Spanish readings are already answered by more than one word and none
 * of them is ambiguous on screen, because what the learner sees differs.
 * `tocar` was the worst of the seven — "to touch" alone drops the half Spanish
 * actually needs, to protect `jugar` = "to play".
 *
 * `el cuarto` is the same case, and the owner made the point themselves: "the
 * quarter/room" beside `la habitación` = "the room" needs no note, because the
 * two faces differ. It went in for *y cuarto*, but *el cuarto* is an everyday
 * word for a room and that meaning was simply missing.
 *
 * **Two pairs genuinely do collide**, and there both halves are labelled, which
 * is the vocabulary's own convention — `because (c)` beside `because (pq)`, 84
 * Spanish entries carrying a note already. The note is grammatical or semantic
 * rather than an initial, because in both pairs there is a real difference to
 * name:
 *
 * - `qué` asks a question and `lo que` joins two clauses, so "what (asking)"
 *   and "what (relative)".
 * - `el tiempo` is time as a quantity and `la vez` a countable occasion, so
 *   "the time (duration)" and "the time (occasion)". `la hora` = "the
 *   hour/time" needs nothing: a third face, already distinct.
 *
 * `answersMatch` drops a parenthesised note, so none of this costs the learner
 * anything in the Spanish-to-English direction. The note does its work only in
 * the direction that shows English, which is the one that needed it.
 *
 * **Two pairs are deliberately not here.** `acabar` and `pues` were dropped
 * from the 1000-word batch rather than narrowed, so they have to be *added*,
 * and they go in with the next batch carrying a `RENOTE` for `terminar` and
 * `bien` in the same run. Labelling those two now would leave `to finish (t)`
 * sitting on its own, where the note means nothing until its sibling arrives.
 *
 * `duro` = "hard (not soft)" is left alone: nothing holds "hard", so that note
 * is doing honest semantic work rather than dodging a guard.
 */

import { runBatch, type Renote } from "./lib/word-batch.js";

const RENOTED: Renote[] = [
  // --- The faces never collided. Give the meaning back. ------------------
  {
    category: "prepositions",
    term: "a través de",
    english: "through",
    why: 'was "by way of" to keep off por = "for/by/through" — a different face',
  },
  {
    category: "adjectives",
    term: "único",
    english: "only/unique",
    why: 'was "unique" to keep off solo = "only/alone" — a different face',
  },
  {
    category: "other",
    term: "ningún",
    english: "no/not any",
    why: 'was "not any" to keep off no = "no" — a different face',
  },
  {
    category: "verbs",
    term: "probar",
    english: "to try/to taste",
    why: 'was "to taste" to keep off intentar = "to try" — a different face',
  },
  {
    category: "verbs",
    term: "tocar",
    english: "to touch/to play (an instrument)",
    why: 'was "to touch" to keep off jugar = "to play", losing the half Spanish needs',
  },
  {
    category: "adverbs",
    term: "luego",
    english: "then/later",
    why: 'was "later" to keep off entonces = "then/so" — a different face',
  },
  {
    category: "prepositions",
    term: "desde",
    english: "since/from",
    why: 'was "since" to keep off de = "of/from" — a different face',
  },
  {
    category: "nouns",
    term: "el cuarto",
    english: "the quarter/room",
    why: 'was "the quarter"; la habitación = "the room" is a different face, so no note needed',
  },

  // --- The faces do collide. Label both halves. -------------------------
  {
    category: "other",
    term: "lo que",
    english: "what (relative)",
    why: 'was "that which"; it means what, and the note says which what',
  },
  {
    category: "other",
    term: "qué",
    english: "what (asking)",
    why: "the other half of the pair — a note on one side needs one on the other",
  },
  {
    category: "nouns",
    term: "la vez",
    english: "the time (occasion)",
    why: 'was "the occasion"; it means time, counted',
  },
  {
    category: "nouns",
    term: "el tiempo",
    english: "the time (duration)",
    why: "the other half of the pair",
  },
];

await runBatch({ script: "scripts/fix-narrowed-glosses.ts", words: [], renoted: RENOTED });
