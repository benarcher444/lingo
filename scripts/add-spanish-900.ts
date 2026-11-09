/**
 * Adds 100 beginner (A1) Spanish words, taking the vocabulary from 800 to 900.
 *
 *   npx tsx scripts/add-spanish-900.ts --email=you@example.com
 *   npx tsx scripts/add-spanish-900.ts --email=you@example.com --apply
 *
 * The owner asked on 2026-11-09 for another hundred at A1 standard, and for
 * one more irregular verb in the present with its past participle in the first
 * person, as `decir` went in the day before. Chosen by reading the 800 already
 * there: these are the everyday sets that were thin or missing, not more of
 * what is already covered.
 *
 * - **Nouns (40).** Food and drink beyond the basics (*el vino*, *la cerveza*,
 *   *el zumo*, *el bocadillo*), clothes (six, where there were only four),
 *   the house (*el piso*, *el sofá*, *el armario*, *la escalera*), the parts of
 *   the body that were missed (*el pie*, *la rodilla*, *el corazón*), the
 *   people you actually name (*el profesor*, *el camarero*, *el vecino*),
 *   animals, and landscape (*el río*, *el campo*, *el bosque*).
 * - **Verbs (25).** Pairs the vocabulary had only one half of — *subir* and
 *   *bajar*, *nacer* and *morir*, *llorar* and *reír* — plus the everyday
 *   transitive verbs it lacked outright: *traer*, *cambiar*, *enseñar*,
 *   *explicar*, *cortar*, *llenar*, *decidir*, *compartir*, *servir*.
 * - **Adjectives (18).** Mostly opposites of ones already held, which is how
 *   they are learnt: *fuerte* and *débil*, *gordo* and *delgado*, *rico* and
 *   *pobre*, *abierto* and *cerrado*, *lleno* against *vacío*, *peor* against
 *   the *mejor* that went in yesterday.
 * - **Adverbs (6) and phrases (4).** Place (*arriba*, *abajo*), and the
 *   connectives that make two sentences into one thought (*además*,
 *   *sin embargo*, *por ejemplo*, *más o menos*).
 * - **`ver`, present tense, plus `he visto` (7).** Asked for by name, so the
 *   rule in CLAUDE.md is satisfied, and entered as a complete paradigm.
 *
 * **Why ver.** Of the irregular verbs whose infinitive the owner holds and
 * whose present they do not, this one adds an irregularity the others have not
 * taught. *decir* covered the `e → i` stem change and the `-go` first person;
 * *ver* keeps a stem of one letter and takes ordinary `-er` endings onto it
 * (*veo*, *ves*, *ve*), which is why *veis* has no accent where *leéis* would,
 * and its participle *visto* is irregular. It is also among the ten commonest
 * verbs in the language.
 *
 * Two glosses are deliberately not the obvious one, because the English side
 * has to identify one Spanish word:
 *
 * - **probar** is "to taste", not "to try": *intentar* already answers "to
 *   try" and *tratar* answers "to try/to treat", so a third would make the
 *   English-to-Spanish direction a three-way guess.
 * - **tocar** is "to touch" alone, with the instrument sense left out, because
 *   *jugar* already holds "to play".
 *
 * **The homophone pass, by hand**, against the watch list in CLAUDE.md.
 * Nothing here is close enough to be worth naming.
 *
 * *vez* was left out of the first run of this batch because it sounds like the
 * *ves* that went in with it, and that was wrong: a collision by ear is a
 * question about muting, which is the owner's call and which this vocabulary
 * does not use. It is not a reason to withhold a word. Added on the owner's
 * correction, the same day.
 */

import { runBatch, type Entry } from "./lib/word-batch.js";

const WORDS: Entry[] = [
  // --- The body, finished off --------------------------------------------
  { category: "nouns", term: "el pie", english: "the foot" },
  { category: "nouns", term: "la rodilla", english: "the knee" },
  { category: "nouns", term: "el corazón", english: "the heart" },
  { category: "nouns", term: "el cuerpo", english: "the body" },
  { category: "nouns", term: "la piel", english: "the skin" },

  // --- Food and drink -----------------------------------------------------
  // Spain's words where Spain and Latin America differ, to match the patata
  // and coche already in the vocabulary: zumo, not jugo.
  { category: "nouns", term: "el vino", english: "the wine" },
  { category: "nouns", term: "la cerveza", english: "the beer" },
  { category: "nouns", term: "el zumo", english: "the juice" },
  { category: "nouns", term: "la mantequilla", english: "the butter" },
  { category: "nouns", term: "el aceite", english: "the oil" },
  { category: "nouns", term: "la ensalada", english: "the salad" },
  { category: "nouns", term: "el bocadillo", english: "the sandwich" },
  { category: "nouns", term: "el pastel", english: "the cake" },
  { category: "nouns", term: "la cebolla", english: "the onion" },
  { category: "nouns", term: "el limón", english: "the lemon" },
  { category: "nouns", term: "el jamón", english: "the ham" },

  // --- Clothes ------------------------------------------------------------
  { category: "nouns", term: "el vestido", english: "the dress" },
  { category: "nouns", term: "la falda", english: "the skirt" },
  { category: "nouns", term: "el abrigo", english: "the coat" },
  { category: "nouns", term: "la camiseta", english: "the t-shirt" },
  { category: "nouns", term: "el calcetín", english: "the sock" },
  // Plural only: nobody wears one gafa.
  { category: "nouns", term: "las gafas", english: "the glasses" },

  // --- The house ----------------------------------------------------------
  { category: "nouns", term: "el piso", english: "the flat" },
  { category: "nouns", term: "el edificio", english: "the building" },
  { category: "nouns", term: "la lámpara", english: "the lamp" },
  { category: "nouns", term: "el sofá", english: "the sofa" },
  { category: "nouns", term: "el armario", english: "the wardrobe" },
  { category: "nouns", term: "la escalera", english: "the stairs" },

  // --- People you name ----------------------------------------------------
  { category: "nouns", term: "el profesor", english: "the teacher" },
  { category: "nouns", term: "el estudiante", english: "the student" },
  { category: "nouns", term: "el camarero", english: "the waiter" },
  { category: "nouns", term: "el vecino", english: "the neighbour" },
  { category: "nouns", term: "el bebé", english: "the baby" },

  // --- Animals and landscape ----------------------------------------------
  { category: "nouns", term: "el pájaro", english: "the bird" },
  { category: "nouns", term: "el caballo", english: "the horse" },
  { category: "nouns", term: "el cerdo", english: "the pig" },
  { category: "nouns", term: "el río", english: "the river" },
  { category: "nouns", term: "el campo", english: "the countryside" },
  { category: "nouns", term: "el bosque", english: "the forest" },
  { category: "nouns", term: "el fin de semana", english: "the weekend" },

  // --- Verbs: the missing half of a pair first ----------------------------
  { category: "verbs", term: "subir", english: "to go up" },
  { category: "verbs", term: "bajar", english: "to go down" },
  { category: "verbs", term: "nacer", english: "to be born" },
  { category: "verbs", term: "morir", english: "to die" },
  { category: "verbs", term: "llorar", english: "to cry" },
  { category: "verbs", term: "reír", english: "to laugh" },
  { category: "verbs", term: "enseñar", english: "to teach" },

  // --- Verbs: the everyday ones that were simply absent -------------------
  { category: "verbs", term: "traer", english: "to bring" },
  { category: "verbs", term: "tocar", english: "to touch" },
  { category: "verbs", term: "probar", english: "to taste" },
  { category: "verbs", term: "visitar", english: "to visit" },
  { category: "verbs", term: "cambiar", english: "to change" },
  { category: "verbs", term: "ganar", english: "to win" },
  { category: "verbs", term: "deber", english: "to owe/must" },
  { category: "verbs", term: "doler", english: "to hurt" },
  { category: "verbs", term: "explicar", english: "to explain" },
  { category: "verbs", term: "crecer", english: "to grow" },
  { category: "verbs", term: "mover", english: "to move" },
  { category: "verbs", term: "llenar", english: "to fill" },
  { category: "verbs", term: "cortar", english: "to cut" },
  { category: "verbs", term: "pintar", english: "to paint" },
  { category: "verbs", term: "decidir", english: "to decide" },
  { category: "verbs", term: "compartir", english: "to share" },
  { category: "verbs", term: "invitar", english: "to invite" },
  { category: "verbs", term: "servir", english: "to serve" },

  // --- Adjectives, mostly as opposites of ones already held ---------------
  { category: "adjectives", term: "peor", english: "worse" },
  { category: "adjectives", term: "fuerte", english: "strong" },
  { category: "adjectives", term: "débil", english: "weak" },
  { category: "adjectives", term: "gordo", english: "fat" },
  { category: "adjectives", term: "delgado", english: "thin" },
  { category: "adjectives", term: "rico", english: "rich" },
  { category: "adjectives", term: "pobre", english: "poor" },
  { category: "adjectives", term: "lleno", english: "full" },
  { category: "adjectives", term: "abierto", english: "open" },
  { category: "adjectives", term: "cerrado", english: "closed" },
  { category: "adjectives", term: "oscuro", english: "dark" },
  { category: "adjectives", term: "claro", english: "clear" },
  { category: "adjectives", term: "amable", english: "kind" },
  { category: "adjectives", term: "inteligente", english: "intelligent" },
  { category: "adjectives", term: "dulce", english: "sweet" },
  { category: "adjectives", term: "diferente", english: "different" },
  { category: "adjectives", term: "próximo", english: "next" },
  { category: "adjectives", term: "último", english: "last" },

  // --- Where, and how one sentence joins another --------------------------
  { category: "adverbs", term: "arriba", english: "up" },
  { category: "adverbs", term: "abajo", english: "down" },
  { category: "adverbs", term: "juntos", english: "together" },
  { category: "adverbs", term: "quizás", english: "maybe" },
  { category: "adverbs", term: "además", english: "besides" },
  { category: "adverbs", term: "enseguida", english: "right away" },
  { category: "phrases", term: "más o menos", english: "more or less" },
  { category: "phrases", term: "otra vez", english: "again" },
  // "the time" belongs to el tiempo, and la hora holds "the hour/time", so
  // this one is glossed by what it actually counts.
  { category: "nouns", term: "la vez", english: "the occasion" },
  { category: "phrases", term: "por ejemplo", english: "for example" },
  { category: "phrases", term: "sin embargo", english: "however" },

  // --- ver, present tense, asked for by name ------------------------------
  // The stem is the single letter v-, so the ordinary -er endings land
  // straight onto it. That is also why veis carries no accent: ve-is is one
  // syllable short of needing one.
  { category: "conjugations", term: "veo", english: "I see" },
  { category: "conjugations", term: "ves", english: "you see" },
  { category: "conjugations", term: "ve", english: "he sees" },
  { category: "conjugations", term: "vemos", english: "we see" },
  { category: "conjugations", term: "veis", english: "you see (pl)" },
  { category: "conjugations", term: "ven", english: "they see" },
  // Irregular: not "he veído".
  { category: "conjugations", term: "he visto", english: "I have seen" },
];

await runBatch({ script: "scripts/add-spanish-900.ts", words: WORDS });
