/**
 * Adds beginner (A1) Spanish words chosen to close gaps in a vocabulary that is
 * already 738 words deep.
 *
 *   npx tsx scripts/add-spanish-gaps.ts --email=you@example.com
 *   npx tsx scripts/add-spanish-gaps.ts --email=you@example.com --apply
 *
 * The owner asked on 2026-11-08 to top Spanish up to 800 and to "fill in holes
 * in my knowledge", so these are not more of the same. Every block below is a
 * pattern or a system the existing words leave unfinished, found by reading the
 * live vocabulary rather than guessing:
 *
 * - **Weather.** *el sol*, *la lluvia*, *la nieve*, *el viento* and *frío* were
 *   all in as nouns and adjectives, but Spanish does not use them that way:
 *   weather goes through *hacer*.
 * - **Where something is.** *cerca* and *lejos* were the only location words,
 *   both adverbs. The compound prepositions — *delante de*, *detrás de* and
 *   the rest — are how you actually place one thing against another.
 * - **Function words.** *otro* and *mismo* are top-100 Spanish words and were
 *   missing outright. *le* and *les* complete an object-pronoun set that had
 *   every other member. *aquel* and *aquella* complete the three-way
 *   demonstrative system that stopped at *este* and *ese*. *mejor* is the
 *   irregular comparative that *más bueno* is not.
 * - **Cognate suffix families.** The owner asked which rules of thumb unlock
 *   whole sets of words, and this is the biggest untapped one in Spanish: 738
 *   words held four *-ción* nouns, two *-dad*, one *-mente* adverb and no
 *   *-encia* at all. These are a seed for the rule — every English *-tion* is
 *   *-ción* and feminine, every *-ty* is *-dad*, *-ous* is *-oso*, *-ly* is
 *   *-mente* — rather than a list to be learnt one at a time.
 *
 * **This batch added 21 conjugations and should not have.** They went in on
 * 2026-11-08 and were withdrawn the same day, unpractised, at the owner's
 * request: the near future (*voy a* … *van a*), the *me gusta* forms, the
 * first person of eight irregular participles, and *llueve* and *nieva*. None of
 * it was asked for. **Conjugations are the owner's own curriculum** — they
 * hold the core patterns and the common irregulars deliberately, not every
 * form of every verb, and they add tenses when they are ready for them. See
 * the rule in CLAUDE.md: a batch adds no conjugation unless the owner asks for
 * it by name, and an irregular that is asked for goes in as a **whole
 * paradigm**, never a single person.
 *
 * One gloss is deliberately narrower than the dictionary: **desde** goes in as
 * "since", not "from". *de* already answers "from", and a shared gloss makes
 * the English-to-Spanish direction a coin flip — the same reason *luego* went
 * in as "later" when *entonces* held "then".
 *
 * **The homophone pass, by hand**, against the watch list in CLAUDE.md — no
 * script can do it. Nothing in the list below collides. The near misses,
 * checked and kept: *nieva* and *nieve* differ in the only vowel either of
 * them has after the stress; *debajo de* keeps its own *de-* against the
 * adjective *bajo*; *hace viento* is longer than *el viento* and distinct from
 * it. The withdrawn *va a* did collide with *va* — Spanish merges identical
 * vowels across a word join — which is recorded in CLAUDE.md against the day
 * the owner does add the *ir + a* paradigm.
 */

import { runBatch, type Entry, type Withdrawal } from "./lib/word-batch.js";

const WORDS: Entry[] = [
  // --- The weather ---------------------------------------------------------
  // Spanish says "it makes cold", so the nouns the owner already has are not
  // how the weather is actually described.
  { category: "phrases", term: "hace frío", english: "it is cold" },
  { category: "phrases", term: "hace calor", english: "it is hot" },
  { category: "phrases", term: "hace sol", english: "it is sunny" },
  { category: "phrases", term: "hace viento", english: "it is windy" },
  { category: "phrases", term: "¿qué tiempo hace?", english: "what is the weather like?" },

  // --- Where something is --------------------------------------------------
  // All but desde and durante end in "de", which is the pattern: a word of
  // place plus de, and then the thing it is measured against.
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
  // indirect pair.
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

/**
 * The 21 conjugations this batch should never have added. Withdrawn on
 * 2026-11-08, the day they went in, at the owner's request — unpractised, so
 * nothing was lost with them.
 *
 * Each is a correction to this list, not a judgement about the Spanish: the
 * near future and the irregular participles are worth learning, and the owner
 * intends to add tenses themselves, in their own order and as whole paradigms.
 */
const WITHDRAWN: Withdrawal[] = [
  // The near future. The owner is keeping to the two tenses they already have.
  { category: "conjugations", term: "voy a", why: "future tense, not asked for" },
  { category: "conjugations", term: "vas a", why: "future tense, not asked for" },
  { category: "conjugations", term: "va a", why: "future tense, not asked for" },
  { category: "conjugations", term: "vamos a", why: "future tense, not asked for" },
  { category: "conjugations", term: "vais a", why: "future tense, not asked for" },
  { category: "conjugations", term: "van a", why: "future tense, not asked for" },

  // gustar conjugated: not a core pattern the owner wanted a paradigm of.
  { category: "conjugations", term: "me gusta", why: "conjugation, not asked for" },
  { category: "conjugations", term: "te gusta", why: "conjugation, not asked for" },
  { category: "conjugations", term: "le gusta", why: "conjugation, not asked for" },
  { category: "conjugations", term: "nos gusta", why: "conjugation, not asked for" },
  { category: "conjugations", term: "me gustan", why: "conjugation, not asked for" },

  // Eight irregular participles, and in the wrong shape besides: one person
  // each, where the owner wants a whole present paradigm or nothing.
  { category: "conjugations", term: "he hecho", why: "conjugation, and first person only" },
  { category: "conjugations", term: "he dicho", why: "conjugation, and first person only" },
  { category: "conjugations", term: "he visto", why: "conjugation, and first person only" },
  { category: "conjugations", term: "he puesto", why: "conjugation, and first person only" },
  { category: "conjugations", term: "he escrito", why: "conjugation, and first person only" },
  { category: "conjugations", term: "he vuelto", why: "conjugation, and first person only" },
  { category: "conjugations", term: "he abierto", why: "conjugation, and first person only" },
  { category: "conjugations", term: "he roto", why: "conjugation, and first person only" },

  // The two weather verbs. The other five weather entries are phrases and stay.
  { category: "conjugations", term: "llueve", why: "conjugation, not asked for" },
  { category: "conjugations", term: "nieva", why: "conjugation, not asked for" },
];

await runBatch({
  script: "scripts/add-spanish-gaps.ts",
  words: WORDS,
  withdrawn: WITHDRAWN,
});
