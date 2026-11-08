/**
 * Adds 62 beginner (A1) Spanish words, chosen to close gaps in a vocabulary
 * that is already 738 words deep — taking it to 800.
 *
 *   npx tsx scripts/add-spanish-gaps.ts --email=you@example.com
 *   npx tsx scripts/add-spanish-gaps.ts --email=you@example.com --apply
 *
 * The owner asked on 2026-11-08 to top Spanish up to 800 and to "fill in holes
 * in my knowledge", so these are not more of the same. Every block below is a
 * pattern or a system the existing 738 words leave unfinished, found by reading
 * the live vocabulary rather than guessing:
 *
 * - **ir + a + infinitive.** The six forms of *ir* were all there; the
 *   construction they exist for was not. This is the tense the owner asked
 *   about by name the same day ("is 'I'm going to walk' simple future?"), and
 *   the `a` is the part that gets dropped.
 * - **gustar.** The infinitive was in; *me gusta* was not. Liking something is
 *   not sayable in Spanish without it, and its backwards shape (the thing
 *   pleases me) is the single most confusing thing at A1.
 * - **The eight irregular past participles.** The owner holds every one of the
 *   infinitives — hacer, decir, ver, poner, escribir, volver, abrir, romper —
 *   and the regular present perfect of eight other verbs, but none of the
 *   irregular participles. First person only, because the auxiliary paradigm
 *   is already learnt six ways over; what is missing is the participle.
 * - **Weather.** *el sol*, *la lluvia*, *la nieve*, *el viento*, *frío* were
 *   all in as nouns and adjectives, but Spanish does not use them that way:
 *   weather goes through *hacer*, and rain and snow are bare verbs. *llueve*
 *   and *nieva* also show the stem change (llover, nevar) in the wild.
 * - **Where something is.** *cerca* and *lejos* were the only location words,
 *   both adverbs. The compound prepositions — *delante de*, *detrás de* and
 *   the rest — are how you actually place one thing against another.
 * - **Function words.** *otro* and *mismo* are top-100 Spanish words and were
 *   missing outright. *le* and *les* complete an object-pronoun set that had
 *   every other member. *aquel* and *aquella* complete the three-way demonstrative
 *   system that stopped at *este* and *ese*. *mejor* is the irregular
 *   comparative that *más bueno* is not.
 * - **Cognate suffix families.** The owner asked which rules of thumb unlock
 *   whole sets of words, and this is the biggest untapped one in Spanish: 738
 *   words held four *-ción* nouns, two *-dad*, one *-mente* adverb and no
 *   *-encia* at all. These fourteen are a seed for the rule — every English
 *   *-tion* is *-ción* and feminine, every *-ty* is *-dad*, *-ous* is *-oso*,
 *   *-ly* is *-mente* — rather than a list to be learnt one at a time.
 *
 * Two glosses are deliberately narrower than the dictionary, because the
 * English side has to identify one Spanish word:
 *
 * - **desde** goes in as "since", not "from". *de* already answers "from", and
 *   a shared gloss makes the English-to-Spanish direction a coin flip — the
 *   same reason *luego* went in as "later" when *entonces* held "then".
 * - **me gustan** goes in as "I like them", with no bracket. "I like (more
 *   than one thing)" would collide with *me gusta*, because answer matching
 *   treats a parenthesised note as optional.
 *
 * **The homophone pass, by hand**, against the watch list in CLAUDE.md — no
 * script can do this, and it found one collision in the 62:
 *
 *   *va a* and *va* are both said [ba]. Spanish merges identical vowels across
 *   a word join, so "va a comer" has no audible second a. The group is
 *   registered in `mute-homophone-audio.ts`; *va* stays audible because it can
 *   stand alone as an utterance and *va a* cannot.
 *
 * Everything else is clear. The near misses, checked and kept: *vamos a* and
 * *vamos* differ in the final syllable; *van a* is two syllables against one;
 * *nieva* and *nieve* differ in the vowel that carries no stress but is the
 * only one there; *debajo de* keeps its own *de-* against the adjective *bajo*;
 * *he hecho* has nothing near it once the h goes silent.
 */

import { runBatch, type Entry } from "./lib/word-batch.js";

const WORDS: Entry[] = [
  // --- Going to do something ----------------------------------------------
  // The near future, and the commonest future in speech. The six forms of ir
  // were already in; what was missing is the "a" that has to follow them.
  { category: "conjugations", term: "voy a", english: "I am going to" },
  { category: "conjugations", term: "vas a", english: "you are going to" },
  { category: "conjugations", term: "va a", english: "he is going to" },
  { category: "conjugations", term: "vamos a", english: "we are going to" },
  { category: "conjugations", term: "vais a", english: "you are going to (pl)" },
  { category: "conjugations", term: "van a", english: "they are going to" },

  // --- Liking something ----------------------------------------------------
  // gustar works backwards: the thing pleases the person, so what is liked is
  // the subject and the person is an object pronoun. "me gustan" is the plural
  // of the *thing*, not of the liker, which is the part that trips people up.
  { category: "conjugations", term: "me gusta", english: "I like" },
  { category: "conjugations", term: "te gusta", english: "you like" },
  { category: "conjugations", term: "le gusta", english: "he likes" },
  { category: "conjugations", term: "nos gusta", english: "we like" },
  { category: "conjugations", term: "me gustan", english: "I like them" },

  // --- The irregular past participles -------------------------------------
  // Eight of them cover almost every irregular participle worth knowing, and
  // the owner already holds all eight infinitives. Each doubles as an
  // adjective, as the -ado/-ido ones do: "la puerta está abierta".
  { category: "conjugations", term: "he hecho", english: "I have done" },
  { category: "conjugations", term: "he dicho", english: "I have said" },
  { category: "conjugations", term: "he visto", english: "I have seen" },
  { category: "conjugations", term: "he puesto", english: "I have put" },
  { category: "conjugations", term: "he escrito", english: "I have written" },
  { category: "conjugations", term: "he vuelto", english: "I have returned" },
  { category: "conjugations", term: "he abierto", english: "I have opened" },
  { category: "conjugations", term: "he roto", english: "I have broken" },

  // --- The weather ---------------------------------------------------------
  // Spanish says "it makes cold", and rain and snow are verbs in their own
  // right. llueve and nieva are also stem changes caught in the act: the
  // infinitives are llover and nevar.
  { category: "phrases", term: "hace frío", english: "it is cold" },
  { category: "phrases", term: "hace calor", english: "it is hot" },
  { category: "phrases", term: "hace sol", english: "it is sunny" },
  { category: "phrases", term: "hace viento", english: "it is windy" },
  { category: "conjugations", term: "llueve", english: "it is raining" },
  { category: "conjugations", term: "nieva", english: "it is snowing" },
  { category: "phrases", term: "¿qué tiempo hace?", english: "what is the weather like?" },

  // --- Where something is --------------------------------------------------
  // All but desde and durante end in "de", which is the pattern: a noun or
  // adverb of place plus de, and then the thing it is measured against.
  { category: "prepositions", term: "desde", english: "since" },
  { category: "prepositions", term: "durante", english: "during" },
  { category: "prepositions", term: "delante de", english: "in front of" },
  { category: "prepositions", term: "detrás de", english: "behind" },
  { category: "prepositions", term: "al lado de", english: "next to" },
  { category: "prepositions", term: "encima de", english: "on top of" },
  { category: "prepositions", term: "debajo de", english: "under" },
  { category: "prepositions", term: "dentro de", english: "inside" },
  { category: "prepositions", term: "fuera de", english: "outside" },

  // --- Function words that were simply absent ------------------------------
  { category: "other", term: "otro", english: "other/another" },
  { category: "other", term: "algún", english: "some" },
  // este and ese were in; Spanish has a third degree for what is far from
  // both speakers, which English has to render as "that over there".
  { category: "other", term: "aquel", english: "that over there (m)" },
  { category: "other", term: "aquella", english: "that over there (f)" },
  // me, te, se, nos, os, lo, la, los, las were all in. These two are the
  // indirect pair, and the reason "le gusta" above is not "lo gusta".
  { category: "other", term: "le", english: "to him/to her" },
  { category: "other", term: "les", english: "to them" },

  { category: "adjectives", term: "mismo", english: "same" },
  { category: "adjectives", term: "mejor", english: "better" },
  { category: "adverbs", term: "bastante", english: "quite/enough" },

  // --- The cognate families, seeded ----------------------------------------
  // -ción: every English -tion, and feminine without exception. The written
  // accent goes in the singular and vanishes in the plural, because -ciones
  // already carries the stress where the rule wants it.
  { category: "nouns", term: "la información", english: "the information" },
  { category: "nouns", term: "la canción", english: "the song" },
  { category: "nouns", term: "la habitación", english: "the room" },
  { category: "nouns", term: "la dirección", english: "the address" },
  // -dad / -tad: every English -ty, also feminine.
  { category: "nouns", term: "la verdad", english: "the truth" },
  { category: "nouns", term: "la edad", english: "the age" },
  { category: "nouns", term: "la libertad", english: "the freedom" },
  // -encia / -ancia: every English -ence / -ance.
  { category: "nouns", term: "la experiencia", english: "the experience" },
  { category: "nouns", term: "la diferencia", english: "the difference" },
  // -mento: every English -ment.
  { category: "nouns", term: "el momento", english: "the moment" },
  // -oso is -ous, -ico is -ic, and -al / -ble are simply the same word.
  { category: "adjectives", term: "famoso", english: "famous" },
  { category: "adjectives", term: "fantástico", english: "fantastic" },
  { category: "adjectives", term: "posible", english: "possible" },
  // especial also shows the other half of the rule: English s + consonant
  // cannot start a Spanish word, so an e- goes in front of it.
  { category: "adjectives", term: "especial", english: "special" },
  { category: "adjectives", term: "importante", english: "important" },
  // -mente is -ly, built on the feminine adjective, and it keeps the
  // adjective's own accent: fácil → fácilmente.
  { category: "adverbs", term: "probablemente", english: "probably" },
  { category: "adverbs", term: "fácilmente", english: "easily" },

  // --- Asking someone's age ------------------------------------------------
  // Spanish *has* years rather than *being* them, which is why this is a
  // phrase and not a sum of its words.
  { category: "phrases", term: "¿cuántos años tienes?", english: "how old are you?" },
];

await runBatch({ script: "scripts/add-spanish-gaps.ts", words: WORDS });
