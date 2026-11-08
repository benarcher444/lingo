/**
 * Takes Spanish from 779 words to 800: the twelve months, one irregular verb
 * in the present, its participle, and two nouns that make the months usable.
 *
 *   npx tsx scripts/add-spanish-800.ts --email=you@example.com
 *   npx tsx scripts/add-spanish-800.ts --email=you@example.com --apply
 *
 * The owner asked for this on 2026-11-08, naming the months and asking for one
 * important irregular present paradigm plus its past participle in the first
 * person, their choice of verb, and two more of mine.
 *
 * **The conjugations here were asked for by name.** That is the whole of the
 * rule in CLAUDE.md: seven of the twenty-one below are conjugations because
 * the owner requested them in those words, and they go in as a complete
 * paradigm — all six persons of the present — rather than the scattering of
 * single forms that an earlier batch got wrong. Nothing here extends the
 * tenses they hold: *he dicho* joins a present perfect that already runs to
 * eight verbs.
 *
 * **Why decir.** Of the irregular verbs whose infinitive the owner already
 * holds and whose present they do not, this one teaches the most at once:
 *
 * - it is an **e → i stem change** (*digo*, *dices*, *dice*), the family that
 *   also covers *pedir*, *repetir* and *seguir*, all three of which are
 *   already in the vocabulary as infinitives with no paradigm to show for it;
 * - its *yo* form takes the **-go** that *tengo*, *vengo* and *hago* already
 *   established, so the hardest form is the familiar one;
 * - *nosotros* and *vosotros* **do not change** (*decimos*, *decís*), which is
 *   the boot shape every stem-changing verb follows;
 * - and its participle **dicho** is irregular, so the one form asked for is
 *   worth more than a regular one would be.
 *
 * **The months are entered bare**, with no article: Spanish says *en enero*,
 * never *en el enero*. The days of the week in this vocabulary do carry *el*
 * (*el lunes*) because Spanish genuinely uses it there, and the difference is
 * real rather than an inconsistency. Spanish does not capitalise them either,
 * which matches the lower-case English side the rest of the data uses.
 *
 * **The homophone pass, by hand**, against the watch list in CLAUDE.md.
 * Nothing collides. One pair is close enough to be worth naming: *junio* and
 * *julio* differ only in the consonant between the vowels, and that is a
 * distinction to learn rather than a coin flip — the two sounds are different
 * and a Spanish ear separates them easily, so the verdict's "Hear another
 * word" button is the right tool for it, not muting. *marzo* against *el
 * martes* and *la fecha* against *el techo* were checked and are clearly
 * distinct. *dice* and *dices* differ by an audible final s, and *decís*
 * moves the stress as well as the vowel.
 */

import { runBatch, type Entry } from "./lib/word-batch.js";

const WORDS: Entry[] = [
  // --- The twelve months ---------------------------------------------------
  // A set that only makes sense complete, and the owner had none of them.
  { category: "nouns", term: "enero", english: "january" },
  { category: "nouns", term: "febrero", english: "february" },
  { category: "nouns", term: "marzo", english: "march" },
  { category: "nouns", term: "abril", english: "april" },
  { category: "nouns", term: "mayo", english: "may" },
  { category: "nouns", term: "junio", english: "june" },
  { category: "nouns", term: "julio", english: "july" },
  { category: "nouns", term: "agosto", english: "august" },
  { category: "nouns", term: "septiembre", english: "september" },
  { category: "nouns", term: "octubre", english: "october" },
  { category: "nouns", term: "noviembre", english: "november" },
  { category: "nouns", term: "diciembre", english: "december" },

  // --- decir, present tense, asked for by name -----------------------------
  // The stem changes in the four forms inside the boot and stays put in the
  // two outside it, which is the pattern rather than a quirk of this verb.
  { category: "conjugations", term: "digo", english: "I say" },
  { category: "conjugations", term: "dices", english: "you say" },
  { category: "conjugations", term: "dice", english: "he says" },
  { category: "conjugations", term: "decimos", english: "we say" },
  { category: "conjugations", term: "decís", english: "you say (pl)" },
  { category: "conjugations", term: "dicen", english: "they say" },
  // The participle, first person, as asked. Irregular: not "he decido".
  { category: "conjugations", term: "he dicho", english: "I have said" },

  // --- Two of mine, chosen to make the months do some work -----------------
  // A month on its own is a label; these are what you say one for. Both are
  // A1 staples the vocabulary did not have, and they sit beside the
  // "¿cuántos años tienes?" that went in earlier today.
  // cumpleaños is invariable: one birthday is already el cumpleaños, and the
  // plural changes only the article.
  { category: "nouns", term: "el cumpleaños", english: "the birthday" },
  { category: "nouns", term: "la fecha", english: "the date" },
];

await runBatch({ script: "scripts/add-spanish-800.ts", words: WORDS });
