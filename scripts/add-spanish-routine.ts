/**
 * Adds a batch of beginner (A1) Spanish vocabulary, weighted toward daily
 * routine: waking up, getting ready, meals, and the shape of a day.
 *
 *   npx tsx scripts/add-spanish-routine.ts --email=you@example.com
 *   npx tsx scripts/add-spanish-routine.ts --email=you@example.com --apply
 *
 * The owner asked on 2026-10-30 to top the Spanish vocabulary up past 700 with
 * more A1 words, and for routine to be covered properly. The list below is the
 * record of what went in.
 *
 * The duplicate guards, the backup and the read-back are in
 * `lib/word-batch.ts`, which every batch shares. The pass it cannot do is the
 * homophone one: the watch list in CLAUDE.md was gone through by hand for this
 * batch and none of these collide.
 */

import { runBatch, type Entry, type Withdrawal } from "./lib/word-batch.js";

/**
 * Daily routine first, because that is what was asked for: the things a
 * morning is made of, then the day's shape, then enough around it to talk
 * about either.
 */
const WORDS: Entry[] = [
  // --- Getting up and getting ready --------------------------------------
  { category: "verbs", term: "despertarse", english: "to wake up" },
  { category: "verbs", term: "levantarse", english: "to get up" },
  { category: "verbs", term: "ducharse", english: "to have a shower" },
  { category: "verbs", term: "vestirse", english: "to get dressed" },
  { category: "verbs", term: "peinarse", english: "to comb your hair" },
  { category: "verbs", term: "afeitarse", english: "to shave" },
  { category: "verbs", term: "ponerse", english: "to put on" },
  { category: "verbs", term: "quitarse", english: "to take off" },
  { category: "nouns", term: "el despertador", english: "the alarm clock" },
  { category: "nouns", term: "la ducha", english: "the shower" },
  { category: "nouns", term: "el jabón", english: "the soap" },
  { category: "nouns", term: "la toalla", english: "the towel" },
  { category: "nouns", term: "el cepillo de dientes", english: "the toothbrush" },
  { category: "nouns", term: "la pasta de dientes", english: "the toothpaste" },
  { category: "nouns", term: "el diente", english: "the tooth" },
  { category: "nouns", term: "el espejo", english: "the mirror" },

  // --- Meals and the table -----------------------------------------------
  { category: "verbs", term: "almorzar", english: "to have lunch" },
  { category: "verbs", term: "preparar", english: "to prepare" },
  { category: "nouns", term: "el almuerzo", english: "the lunch" },
  { category: "nouns", term: "la merienda", english: "the afternoon snack" },
  { category: "nouns", term: "la cuchara", english: "the spoon" },
  { category: "nouns", term: "el tenedor", english: "the fork" },
  { category: "nouns", term: "el cuchillo", english: "the knife" },

  // --- Winding down -------------------------------------------------------
  { category: "verbs", term: "acostarse", english: "to go to bed" },
  { category: "verbs", term: "dormirse", english: "to fall asleep" },
  { category: "verbs", term: "descansar", english: "to rest" },
  { category: "verbs", term: "sentarse", english: "to sit down" },
  { category: "verbs", term: "apagar", english: "to turn off" },
  { category: "verbs", term: "encender", english: "to turn on" },
  { category: "nouns", term: "la siesta", english: "the nap" },
  { category: "nouns", term: "el dormitorio", english: "the bedroom" },
  { category: "nouns", term: "el salón", english: "the living room" },

  // --- The day itself, and what fills it ----------------------------------
  { category: "verbs", term: "olvidar", english: "to forget" },
  { category: "verbs", term: "repetir", english: "to repeat" },
  { category: "verbs", term: "enviar", english: "to send" },
  { category: "verbs", term: "recoger", english: "to pick up" },
  { category: "nouns", term: "la rutina", english: "the routine" },
  { category: "nouns", term: "el horario", english: "the timetable" },
  { category: "nouns", term: "la oficina", english: "the office" },
  { category: "nouns", term: "los deberes", english: "the homework" },
  { category: "nouns", term: "la cita", english: "the appointment" },
  { category: "nouns", term: "la llamada", english: "the phone call" },
  { category: "nouns", term: "la basura", english: "the rubbish" },

  // --- A reflexive verb conjugated, since that is the part that trips you
  // up. The present of levantarse, in the same shape as the paradigms already
  // there: the pronoun moves to the front, the ending is an ordinary -ar one.
  { category: "conjugations", term: "me levanto", english: "I get up" },
  { category: "conjugations", term: "te levantas", english: "you get up" },
  { category: "conjugations", term: "se levanta", english: "he gets up" },
  { category: "conjugations", term: "nos levantamos", english: "we get up" },
  { category: "conjugations", term: "os levantáis", english: "you get up (pl)" },
  { category: "conjugations", term: "se levantan", english: "they get up" },

  // --- How you describe a day ---------------------------------------------
  { category: "adjectives", term: "ocupado", english: "busy" },
  { category: "adjectives", term: "listo", english: "ready" },
  { category: "adjectives", term: "diario", english: "daily" },
  { category: "adjectives", term: "despierto", english: "awake" },
  { category: "adjectives", term: "dormido", english: "asleep" },

  // --- How often, and in what order ---------------------------------------
  { category: "adverbs", term: "normalmente", english: "usually" },
  { category: "adverbs", term: "luego", english: "later" },
  { category: "adverbs", term: "primero", english: "first" },
  { category: "adverbs", term: "pronto", english: "soon" },
  { category: "adverbs", term: "despacio", english: "slowly" },
  { category: "phrases", term: "todos los días", english: "every day" },
  { category: "phrases", term: "a veces", english: "sometimes" },
  { category: "phrases", term: "a menudo", english: "often" },
  { category: "phrases", term: "de vez en cuando", english: "from time to time" },
  { category: "phrases", term: "por la mañana", english: "in the morning" },
  { category: "phrases", term: "por la tarde", english: "in the afternoon" },
  { category: "phrases", term: "por la noche", english: "at night" },

  // --- Telling the time, which is what a routine is pinned to --------------
  { category: "phrases", term: "¿qué hora es?", english: "what time is it?" },
  { category: "phrases", term: "y media", english: "half past" },
  { category: "phrases", term: "y cuarto", english: "quarter past" },
  { category: "phrases", term: "menos cuarto", english: "quarter to" },
  { category: "phrases", term: "en punto", english: "o'clock" },

  // --- Saying you have to do it -------------------------------------------
  // tener que is an ordinary verb with "que" plus an infinitive bolted on, so
  // it conjugates like any other and belongs with the paradigms. The owner
  // asked for the full set on 2026-10-30, and for "tengo que" to stop being
  // filed as a phrase. "hay que" stays here: it is impersonal and has no
  // paradigm to belong to.
  { category: "conjugations", term: "tengo que", english: "I have to" },
  { category: "conjugations", term: "tienes que", english: "you have to" },
  { category: "conjugations", term: "tiene que", english: "he has to" },
  { category: "conjugations", term: "tenemos que", english: "we have to" },
  { category: "conjugations", term: "tenéis que", english: "you have to (pl)" },
  { category: "conjugations", term: "tienen que", english: "they have to" },
  { category: "conjugations", term: "he tenido que", english: "I have had to" },
  { category: "conjugations", term: "has tenido que", english: "you have had to" },
  { category: "conjugations", term: "ha tenido que", english: "he has had to" },
  { category: "conjugations", term: "hemos tenido que", english: "we have had to" },
  { category: "conjugations", term: "habéis tenido que", english: "you have had to (pl)" },
  { category: "conjugations", term: "han tenido que", english: "they have had to" },
  { category: "phrases", term: "hay que", english: "one has to" },

  // --- The present perfect of venir, asked for on 2026-10-30. The present
  // was entered by hand the day before, so this completes it. The -s and -n
  // of "has"/"han" survive in front of the v, so unlike the "sido"/"ido"
  // family none of these six sound alike.
  { category: "conjugations", term: "he venido", english: "I have come" },
  { category: "conjugations", term: "has venido", english: "you have come" },
  { category: "conjugations", term: "ha venido", english: "he has come" },
  { category: "conjugations", term: "hemos venido", english: "we have come" },
  { category: "conjugations", term: "habéis venido", english: "you have come (pl)" },
  { category: "conjugations", term: "han venido", english: "they have come" },
];

/**
 * Entries this script put in that no longer belong where they were. Withdrawing
 * one is only ever a correction to this list, never a way to drop a word the
 * owner has been practising: a word with answers behind it is refused and
 * reported, because deleting it would take its history with it.
 */
const WITHDRAWN: Withdrawal[] = [
  {
    category: "phrases",
    term: "tengo que",
    why: "moved to conjugations, with the rest of the tener que paradigm",
  },
];

await runBatch({
  script: "scripts/add-spanish-routine.ts",
  words: WORDS,
  withdrawn: WITHDRAWN,
});
