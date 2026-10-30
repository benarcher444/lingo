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
 * Running it twice is safe: a word already in its category is left alone, so a
 * second run adds nothing. Two guards decide what may go in, and both exist
 * because a question with two right answers records a real miss:
 *
 * - **The same spelling in the same category** is what the app itself calls a
 *   duplicate, so the check imports `spellingKey` rather than re-deciding what
 *   "the same word" means. Another category may hold the same spelling, as
 *   with *como* the conjunction and *como* the conjugation.
 * - **The same English on two words** makes the English-to-Spanish direction a
 *   coin flip — the written counterpart of the homophone problem that
 *   `mute-homophone-audio.ts` solves for listening. A word whose gloss is
 *   already taken is reported and skipped rather than entered.
 *
 * What no script can check is whether a new word is a *homophone* of one
 * already there. The watch list in CLAUDE.md was gone through by hand for this
 * batch and none of these collide. A later batch needs the same pass.
 */

import { eq } from "drizzle-orm";

import { databasePath, db, sqlite } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";
import { spellingKey } from "../src/routes/vocab.js";

interface Entry {
  category: string;
  term: string;
  english: string;
}

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
  { category: "phrases", term: "tengo que", english: "I have to" },
  { category: "phrases", term: "hay que", english: "one has to" },
];

const apply = process.argv.includes("--apply");
const emailArg = process.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length);
const languageName =
  process.argv.find((a) => a.startsWith("--language="))?.slice("--language=".length) ?? "Spanish";

if (!emailArg) {
  console.error(
    "Which account? This adds words to one person's vocabulary, so it has to be named:\n" +
      "  npx tsx scripts/add-spanish-routine.ts --email=you@example.com",
  );
  process.exit(1);
}

const account = db.select().from(users).where(eq(users.email, emailArg)).get();
if (!account) {
  console.error(`No account for ${emailArg}.`);
  process.exit(1);
}

const language = db
  .select()
  .from(languages)
  .where(eq(languages.userId, account.id))
  .all()
  .find((l) => l.name.toLowerCase() === languageName.toLowerCase());
if (!language) {
  console.error(`${emailArg} has no ${languageName}.`);
  process.exit(1);
}

const types = db.select().from(wordTypes).where(eq(wordTypes.languageId, language.id)).all();
const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));

const existing = types.flatMap((type) =>
  db
    .select()
    .from(words)
    .where(eq(words.wordTypeId, type.id))
    .all()
    .map((w) => ({ ...w, category: type.name })),
);

/** Spelling already used, per category: the app's own idea of a duplicate. */
const spellingsByType = new Map<number, Set<string>>();
for (const w of existing) {
  const set = spellingsByType.get(w.wordTypeId) ?? new Set<string>();
  set.add(spellingKey(w.term));
  spellingsByType.set(w.wordTypeId, set);
}

/** Gloss already used anywhere in the language, and by which word. */
const glossKey = (english: string) => english.trim().replace(/\s+/g, " ").toLowerCase();
const byGloss = new Map<string, { term: string; category: string }>();
for (const w of existing) byGloss.set(glossKey(w.english), { term: w.term, category: w.category });

const toAdd: { entry: Entry; wordTypeId: number }[] = [];
const already: Entry[] = [];
const refused: { entry: Entry; why: string }[] = [];

for (const entry of WORDS) {
  const type = typeByName.get(entry.category.toLowerCase());
  if (!type) {
    refused.push({ entry, why: `no "${entry.category}" category in ${language.name}` });
    continue;
  }

  if (spellingsByType.get(type.id)?.has(spellingKey(entry.term))) {
    already.push(entry);
    continue;
  }

  const clash = byGloss.get(glossKey(entry.english));
  if (clash) {
    refused.push({
      entry,
      why: `"${entry.english}" is already ${clash.term} (${clash.category}) — two right answers`,
    });
    continue;
  }

  toAdd.push({ entry, wordTypeId: type.id });

  // Claim both keys now, so the batch cannot collide with itself.
  const set = spellingsByType.get(type.id) ?? new Set<string>();
  set.add(spellingKey(entry.term));
  spellingsByType.set(type.id, set);
  byGloss.set(glossKey(entry.english), { term: entry.term, category: entry.category });
}

console.log(`${account.email} · ${language.name} · ${existing.length} words now\n`);

for (const { entry } of toAdd) {
  console.log(`  + ${entry.category.padEnd(13)} ${entry.term.padEnd(24)} ${entry.english}`);
}
for (const entry of already) {
  console.log(`  = ${entry.category.padEnd(13)} ${entry.term.padEnd(24)} already there`);
}
for (const { entry, why } of refused) {
  console.log(`  ! ${entry.category.padEnd(13)} ${entry.term.padEnd(24)} ${why}`);
}

console.log(
  `\n${toAdd.length} to add, ${already.length} already there, ${refused.length} refused` +
    ` — ${existing.length} → ${existing.length + toAdd.length} words.`,
);

if (!toAdd.length) {
  console.log("Nothing to do.");
  process.exit(refused.length ? 1 : 0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to make these changes.");
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const target = `${databasePath.replace(/\.db$/, "")}-pre-add-${stamp}.db`;
await sqlite.backup(target);
console.log(`\nBacked up ${databasePath} → ${target}`);

db.insert(words)
  .values(
    toAdd.map(({ entry, wordTypeId }) => ({
      wordTypeId,
      term: entry.term,
      english: entry.english,
    })),
  )
  .run();

// Read it back rather than trust the insert count.
const after = types.flatMap((type) =>
  db.select().from(words).where(eq(words.wordTypeId, type.id)).all(),
);
const present = new Set(after.map((w) => `${w.wordTypeId}:${spellingKey(w.term)}`));
const missing = toAdd.filter(
  ({ entry, wordTypeId }) => !present.has(`${wordTypeId}:${spellingKey(entry.term)}`),
);

console.log(
  `Applied. ${toAdd.length - missing.length}/${toAdd.length} added, ${after.length} words now.`,
);

if (missing.length) {
  console.error(`Not added: ${missing.map((m) => m.entry.term).join(", ")}`);
  process.exit(1);
}
