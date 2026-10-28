/**
 * Turns listening off for words that cannot be told apart by ear.
 *
 *   npx tsx scripts/mute-homophone-audio.ts            # show what would change
 *   npx tsx scripts/mute-homophone-audio.ts --apply    # change it
 *
 * Listening plays a word and asks for its English. When two entries are true
 * homophones that is a coin flip, and a wrong guess records a real miss — so
 * the honest record of what the learner knows gets worse the more they
 * practise. The fix is not leniency in the marking: it is to stop asking.
 *
 * Each group below keeps exactly one entry audible, so what you hear has one
 * answer. The one kept is the one that can stand alone as an utterance —
 * "sí" is a whole reply, "si" never is; "tú" is said alone, "tu" is a
 * proclitic; "por qué" is a question, "porque" answers one. Where both can
 * stand alone, the more frequent wins.
 *
 * Nothing is deleted. The muted entries stay in written and speaking practice,
 * keep their history, and re-enabling audio restores them exactly — so this is
 * reversible from the vocabulary page, one checkbox per word.
 */

import { eq, inArray } from "drizzle-orm";

import { databasePath, db, sqlite } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";

const apply = process.argv.includes("--apply");

interface Collision {
  language: string;
  /** How the whole group sounds, stress in capitals. */
  sound: string;
  /** Stays audible: the one entry that answer belongs to. */
  keep: string;
  /** Loses listening, keeps everything else. */
  mute: string[];
  why: string;
}

/** The written accent marks stress, which saying a word alone supplies anyway. */
const STRESS_ONLY = "the accent marks stress, which saying it alone supplies anyway";

/**
 * Spanish never doubles a consonant across a word join, and a word-final s
 * resyllabifies onto a following vowel. That is what makes the whole "sido"
 * family collapse: "ha sido", "has sido" and "has ido" are one sound. Forms
 * whose participle starts with a consonant are safe, because the -s survives
 * there — "ha tenido" and "has tenido" stay distinct.
 */
const S_MERGE = "s+s merge into one s, and a word-final s resyllabifies onto a vowel";

const COLLISIONS: Collision[] = [
  { language: "Spanish", sound: "ke", keep: "qué", mute: ["que"], why: STRESS_ONLY },
  { language: "Spanish", sound: "si", keep: "sí", mute: ["si"], why: STRESS_ONLY },
  { language: "Spanish", sound: "KO-mo", keep: "cómo", mute: ["como"], why: STRESS_ONLY },
  { language: "Spanish", sound: "KWAN-do", keep: "cuándo", mute: ["cuando"], why: STRESS_ONLY },
  { language: "Spanish", sound: "tu", keep: "tú", mute: ["tu"], why: STRESS_ONLY },
  {
    language: "Spanish",
    sound: "por-KE",
    keep: "por qué",
    mute: ["porque"],
    why: "the space is not audible",
  },
  { language: "Spanish", sound: "a-SI-do", keep: "ha sido", mute: ["has sido", "has ido"], why: S_MERGE },
  { language: "Spanish", sound: "e-mo-SI-do", keep: "hemos sido", mute: ["hemos ido"], why: S_MERGE },
  { language: "Spanish", sound: "a-bei-SI-do", keep: "habéis sido", mute: ["habéis ido"], why: S_MERGE },
  {
    language: "French",
    sound: "or",
    keep: "or",
    mute: ["hors"],
    why: "h is silent and the final s is not pronounced",
  },
];

/** Glosses that reject an answer the learner was right to give. */
const GLOSS_FIXES: { language: string; term: string; english: string; why: string }[] = [
  {
    language: "Spanish",
    term: "su",
    english: "his/her/their",
    why: '"her" was marked wrong; "your" is left out so it stays distinct from "tu"',
  },
  { language: "Spanish", term: "he ido", english: "I have gone", why: "lower-case i" },
];

interface Entry {
  id: number;
  english: string;
  audioEnabled: boolean;
  category: string;
}

/** language name → term → the entries carrying that term, for one account. */
function vocabulary(userId: number): Map<string, Map<string, Entry[]>> {
  const index = new Map<string, Map<string, Entry[]>>();

  for (const language of db.select().from(languages).where(eq(languages.userId, userId)).all()) {
    const byTerm = new Map<string, Entry[]>();

    for (const type of db.select().from(wordTypes).where(eq(wordTypes.languageId, language.id)).all()) {
      for (const row of db.select().from(words).where(eq(words.wordTypeId, type.id)).all()) {
        const key = row.term.trim().toLowerCase();
        const list = byTerm.get(key) ?? [];
        list.push({
          id: row.id,
          english: row.english,
          audioEnabled: row.audioEnabled,
          category: type.name,
        });
        byTerm.set(key, list);
      }
    }

    index.set(language.name, byTerm);
  }

  return index;
}

const muteIds: number[] = [];
const glossUpdates: { id: number; term: string; from: string; to: string }[] = [];
let skipped = 0;

for (const account of db.select().from(users).all()) {
  const vocab = vocabulary(account.id);
  if (![...vocab.keys()].some((name) => COLLISIONS.some((c) => c.language === name))) continue;

  console.log(`\n=== ${account.email} ===`);

  for (const group of COLLISIONS) {
    const byTerm = vocab.get(group.language);
    if (!byTerm) continue;

    const kept = byTerm.get(group.keep.toLowerCase()) ?? [];
    const targets = group.mute.flatMap((term) => byTerm.get(term.toLowerCase()) ?? []);
    if (!kept.length && !targets.length) continue;

    console.log(`\n${group.language}, "${group.sound}" — ${group.why}`);

    // Muting every member would leave the sound unanswerable rather than
    // unambiguous, so change nothing in this group and say why.
    if (!kept.length) {
      console.log(`  ! "${group.keep}" is not in the vocabulary — skipping this group`);
      skipped += 1;
      continue;
    }

    for (const k of kept) {
      console.log(`  keep  ${group.keep} = "${k.english}" [${k.category} ${k.id}]`);
    }

    for (const term of group.mute) {
      const found = byTerm.get(term.toLowerCase()) ?? [];
      if (!found.length) {
        console.log(`  -     "${term}" is not in the vocabulary`);
        continue;
      }
      for (const t of found) {
        console.log(
          `  mute  ${term} = "${t.english}" [${t.category} ${t.id}]${t.audioEnabled ? "" : " (already off)"}`,
        );
        if (t.audioEnabled) muteIds.push(t.id);
      }
    }
  }

  for (const fix of GLOSS_FIXES) {
    for (const m of vocab.get(fix.language)?.get(fix.term.toLowerCase()) ?? []) {
      if (m.english === fix.english) continue;
      console.log(`\n${fix.language} gloss: ${fix.term} [${m.id}] "${m.english}" → "${fix.english}" — ${fix.why}`);
      glossUpdates.push({ id: m.id, term: fix.term, from: m.english, to: fix.english });
    }
  }
}

const toMute = [...new Set(muteIds)];

console.log(
  `\n${toMute.length} word(s) to lose listening, ${glossUpdates.length} gloss(es) to correct` +
    (skipped ? `, ${skipped} group(s) skipped` : ""),
);

if (!toMute.length && !glossUpdates.length) {
  console.log("Nothing to do.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to make these changes.");
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const target = `${databasePath.replace(/\.db$/, "")}-pre-mute-${stamp}.db`;
await sqlite.backup(target);
console.log(`\nBacked up ${databasePath} → ${target}`);

if (toMute.length) {
  db.update(words).set({ audioEnabled: false }).where(inArray(words.id, toMute)).run();
}

for (const g of glossUpdates) {
  db.update(words).set({ english: g.to }).where(eq(words.id, g.id)).run();
}

// Read it back rather than trust the update count.
const muted = toMute.length
  ? db
      .select({ id: words.id, audioEnabled: words.audioEnabled })
      .from(words)
      .where(inArray(words.id, toMute))
      .all()
  : [];
const stillAudible = muted.filter((r) => r.audioEnabled);

const glossesNow = glossUpdates.filter((g) => {
  const row = db.select({ english: words.english }).from(words).where(eq(words.id, g.id)).get();
  return row?.english === g.to;
});

console.log(
  `Applied. ${toMute.length - stillAudible.length}/${toMute.length} muted, ` +
    `${glossesNow.length}/${glossUpdates.length} gloss(es) corrected.`,
);

if (stillAudible.length) {
  console.error(`Still audible: ${stillAudible.map((r) => r.id).join(", ")}`);
  process.exit(1);
}
