/**
 * Adds 99 beginner Spanish words, taking the vocabulary from 901 to 1000.
 *
 *   npx tsx scripts/add-spanish-1000.ts --email=you@example.com
 *   npx tsx scripts/add-spanish-1000.ts --email=you@example.com --apply
 *
 * The owner asked on 2026-11-15 for the next hundred and for the total to land
 * on 1000 exactly, so this is 99 and not 100.
 *
 * **This is the first batch chosen by frequency rather than by topic**, and the
 * first taken from `WORD-QUEUE.md`. Every batch before it was picked by reading
 * the vocabulary and looking for thin topics — clothes were short, the body was
 * half-done — which finds missing categories and is blind to missing function
 * words, because `tan` and `asi` belong to no topic and nothing looks thin when
 * they are gone. After 241 words added that way the vocabulary held
 * `el bisabuelo` and `la pasta de dientes` but not `tan`, `usted`, `lo que` or
 * `la idea`, several of them top-150 words. The owner asked why on 2026-11-11.
 *
 * So this batch is deliberately dull to read: 71 of the 99 are small
 * structural words. That is the correction, not an accident.
 *
 * - **Function words (20).** `usted` and `ustedes` matter most — the
 *   vocabulary had *tú* and *vosotros*, so there was no way to address a
 *   stranger politely, and in Latin America *ustedes* is the only plural you.
 *   The plural demonstratives were all missing against singulars that were all
 *   present. `tan`, `así` and `lo que` are top-150.
 * - **Compound prepositions and connectives (18).** The vocabulary had `antes`
 *   and `después` as bare adverbs but not the `de` forms that attach them to a
 *   noun, and the same for `cerca` and `lejos`. One small word each, and they
 *   turn clauses into sentences.
 * - **The words behind phrases already held (11).** The owner asked on
 *   2026-11-11 that a phrase's own words be in the vocabulary too, having found
 *   `por ejemplo` with no `el ejemplo` behind it. A phrase you cannot take
 *   apart has been memorised rather than understood. Found by sweeping all 40
 *   phrases; `lib/word-batch.ts` now reports this for any phrase going in.
 * - **Abstract and relational nouns (20).** The 300 nouns were almost entirely
 *   concrete, and conversation past the transactional runs on these: "the
 *   reason I think that" was unsayable.
 * - **Evaluative adjectives (23).** The adjectives already held are
 *   physical-property pairs and well done. What was missing was the whole
 *   register for judging things, which is most of what adjectives do in speech.
 * - **Verbs (9).** The cap is one per ten words added, so 99 words allow 9.
 *   `importar`, `faltar` and `encantar` are the backwards pattern of *gustar*
 *   and *doler*, both already held — three words for a grammar point already
 *   paid for.
 *
 * **No conjugations.** None were asked for.
 *
 * **Glosses that are deliberately not the obvious one.** The gloss guard only
 * compares exact strings, but answer matching treats a slash as either reading
 * and drops a parenthesised note, so two cards can collide without the guard
 * noticing. Checked by hand against every reading the vocabulary already
 * accepts:
 *
 * - `el cuarto` is "the quarter" alone. As "the quarter/room" it would collide
 *   with `la habitación`.
 * - `único` is "unique", not "only/unique", which would collide with `solo`.
 * - `ningún` is "not any", because `no` already answers "no".
 * - `lo que` is "that which", because `qué` already answers "what".
 * - `a través de` is "by way of", because `por` already answers "through".
 * - `duro` is "hard (not soft)" to keep it off `difícil`.
 * - `acabar` was wanted but is **not** here: it means "to finish", which
 *   `terminar` already answers. `llamarse` took the slot, being the infinitive
 *   behind the `me llamo` phrase already held. `acabar` stays queued until its
 *   gloss is decided.
 * - `pues` was dropped: "well" is already `bien`, and unlike the cases below
 *   there is no note that distinguishes it. `falso` took the slot.
 *
 * **Collisions accepted**, because they are the vocabulary's own convention:
 * `usted` and `ustedes` both reduce to "you", as `tú`, `te`, `vosotros` and
 * `os` already do, and the plural demonstratives pair off the way `este` and
 * `esta` already do. The parenthesised note tells them apart on the card. This
 * is the same trade as `because (c)` and `because (pq)` in French.
 *
 * **The homophone pass, by hand**, against the watch list in CLAUDE.md.
 * `cual` was left out of this batch for being low value, not for colliding
 * with `cuál` — a collision by ear is never a reason to withhold a word, and
 * "Hear another word" is what one is for.
 */

import { runBatch, type Entry } from "./lib/word-batch.js";

const WORDS: Entry[] = [
  // --- Function words -----------------------------------------------------
  // The politeness hole: there was no way to address a stranger.
  { category: "other", term: "usted", english: "you (formal)" },
  { category: "other", term: "ustedes", english: "you (formal pl)" },
  { category: "other", term: "tan", english: "so (+ adj)" },
  { category: "other", term: "tanto", english: "so much" },
  { category: "other", term: "así", english: "like this" },
  { category: "other", term: "lo que", english: "that which" },
  { category: "other", term: "ningún", english: "not any" },
  { category: "other", term: "ninguno", english: "none" },
  { category: "other", term: "sino", english: "but rather" },
  { category: "other", term: "todos", english: "everyone" },
  { category: "other", term: "cualquier", english: "any" },
  { category: "other", term: "contigo", english: "with you" },
  { category: "other", term: "tal", english: "such" },
  // Every singular demonstrative was in and no plural was.
  { category: "other", term: "estos", english: "these (m)" },
  { category: "other", term: "estas", english: "these (f)" },
  { category: "other", term: "esos", english: "those (m)" },
  { category: "other", term: "esas", english: "those (f)" },
  { category: "other", term: "aquellos", english: "those over there (m)" },
  { category: "other", term: "mío", english: "mine" },
  { category: "other", term: "tuyo", english: "yours" },

  // --- Compound prepositions ----------------------------------------------
  { category: "prepositions", term: "hacia", english: "towards" },
  { category: "prepositions", term: "según", english: "according to" },
  { category: "prepositions", term: "contra", english: "against" },
  { category: "prepositions", term: "antes de", english: "before (+ noun)" },
  { category: "prepositions", term: "después de", english: "after (+ noun)" },
  { category: "prepositions", term: "cerca de", english: "near to" },
  { category: "prepositions", term: "lejos de", english: "far from" },
  { category: "prepositions", term: "enfrente de", english: "opposite" },
  { category: "prepositions", term: "junto a", english: "beside" },
  { category: "prepositions", term: "a través de", english: "by way of" },
  { category: "prepositions", term: "a pesar de", english: "despite" },
  { category: "prepositions", term: "en vez de", english: "instead of" },
  { category: "prepositions", term: "además de", english: "as well as" },

  // --- Conjunctions -------------------------------------------------------
  { category: "conjunctions", term: "así que", english: "therefore" },
  { category: "conjunctions", term: "ya que", english: "given that" },
  { category: "conjunctions", term: "para que", english: "so that" },
  { category: "conjunctions", term: "sin que", english: "without (+ clause)" },
  { category: "conjunctions", term: "a menos que", english: "unless" },

  // --- The words behind phrases already held ------------------------------
  { category: "nouns", term: "el ejemplo", english: "the example" }, // por ejemplo
  { category: "nouns", term: "el calor", english: "the heat" }, // hace calor
  { category: "nouns", term: "el punto", english: "the point" }, // en punto
  { category: "nouns", term: "el cuarto", english: "the quarter" }, // y cuarto
  { category: "nouns", term: "el favor", english: "the favour" }, // por favor
  { category: "nouns", term: "el gusto", english: "the pleasure" }, // mucho gusto
  { category: "nouns", term: "el permiso", english: "the permission" }, // con permiso
  { category: "nouns", term: "el fin", english: "the end" }, // el fin de semana
  // Asked for by name. `salud` is already held in `other`, bare, as an
  // interjection ("cheers"); the noun goes in beside it with its article,
  // which is what tells the two apart.
  { category: "nouns", term: "la salud", english: "the health" },
  { category: "adjectives", term: "medio", english: "half" }, // y media

  // --- Abstract and relational nouns --------------------------------------
  { category: "nouns", term: "la idea", english: "the idea" },
  { category: "nouns", term: "la razón", english: "the reason" },
  { category: "nouns", term: "la manera", english: "the way/manner" },
  { category: "nouns", term: "la forma", english: "the shape" },
  { category: "nouns", term: "el tipo", english: "the type" },
  { category: "nouns", term: "la parte", english: "the part" },
  // `el fin` is the end as a point in time, `el final` the ending of a thing.
  { category: "nouns", term: "el final", english: "the ending" },
  { category: "nouns", term: "el principio", english: "the beginning" },
  { category: "nouns", term: "el centro", english: "the centre" },
  { category: "nouns", term: "el lado", english: "the side" },
  { category: "nouns", term: "el resto", english: "the rest" },
  { category: "nouns", term: "el nivel", english: "the level" },
  { category: "nouns", term: "la situación", english: "the situation" },
  { category: "nouns", term: "la solución", english: "the solution" },
  { category: "nouns", term: "el resultado", english: "the result" },
  { category: "nouns", term: "la vista", english: "the view" },
  { category: "nouns", term: "el caso", english: "the case" },
  { category: "nouns", term: "el orden", english: "the order" },
  { category: "nouns", term: "la cantidad", english: "the quantity" },
  { category: "nouns", term: "el espacio", english: "the space" },

  // --- Evaluative adjectives ----------------------------------------------
  { category: "adjectives", term: "seguro", english: "sure/safe" },
  { category: "adjectives", term: "raro", english: "strange" },
  { category: "adjectives", term: "propio", english: "own" },
  { category: "adjectives", term: "único", english: "unique" },
  { category: "adjectives", term: "necesario", english: "necessary" },
  { category: "adjectives", term: "imposible", english: "impossible" },
  { category: "adjectives", term: "cierto", english: "certain" },
  { category: "adjectives", term: "común", english: "common" },
  { category: "adjectives", term: "normal", english: "normal" },
  { category: "adjectives", term: "suficiente", english: "sufficient" },
  { category: "adjectives", term: "útil", english: "useful" },
  { category: "adjectives", term: "serio", english: "serious" },
  { category: "adjectives", term: "duro", english: "hard (not soft)" },
  { category: "adjectives", term: "aburrido", english: "boring" },
  { category: "adjectives", term: "contento", english: "pleased" },
  { category: "adjectives", term: "preocupado", english: "worried" },
  { category: "adjectives", term: "loco", english: "crazy" },
  { category: "adjectives", term: "verdadero", english: "true" },
  { category: "adjectives", term: "falso", english: "false" },
  { category: "adjectives", term: "varios", english: "several" },
  { category: "adjectives", term: "ligero", english: "light (in weight)" },
  { category: "adjectives", term: "pesado", english: "heavy" },

  // --- Verbs: nine, which is the cap for 99 words -------------------------
  // The first three are gustar's backwards pattern, already paid for.
  { category: "verbs", term: "importar", english: "to matter" },
  { category: "verbs", term: "faltar", english: "to be lacking" },
  { category: "verbs", term: "encantar", english: "to delight" },
  { category: "verbs", term: "costar", english: "to cost" },
  { category: "verbs", term: "llamarse", english: "to be called" },
  { category: "verbs", term: "mostrar", english: "to show" },
  { category: "verbs", term: "conseguir", english: "to manage/obtain" },
  { category: "verbs", term: "caer", english: "to fall" },
  { category: "verbs", term: "soler", english: "to usually do" },
];

await runBatch({ script: "scripts/add-spanish-1000.ts", words: WORDS });
