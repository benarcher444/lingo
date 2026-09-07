/**
 * Creates a demo account with enough vocabulary and history to exercise every
 * page. Used for screenshots and for eyeballing the UI; safe to re-run.
 *
 *   npm run seed
 *
 * Pass --reset to wipe the demo user first.
 */

import { eq } from "drizzle-orm";

import { hashPassword } from "../src/auth.js";
import { db } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  attempts,
  languages,
  progress,
  statSnapshots,
  users,
  wordTypes,
  words,
} from "../src/db/schema.js";
import {
  loadScoredWords,
  recordSnapshot,
  summarise,
  summariseByType,
} from "../src/stats.js";

const EMAIL = "demo@lingo.local";
const PASSWORD = "demopassword";

/** A second account with nothing in it, so the empty states can be reviewed. */
const EMPTY_EMAIL = "empty@lingo.local";

const VOCAB: Record<string, [string, string][]> = {
  nouns: [
    ["la femme", "the woman"],
    ["le gouvernement", "the government"],
    ["le chien", "the dog"],
    ["la maison", "the house"],
    ["le livre", "the book"],
    ["la ville", "the city"],
    ["le travail", "the work"],
    ["la voiture", "the car"],
    ["le temps", "the time"],
    ["la porte", "the door"],
    ["l'eau", "the water"],
    ["le pain", "the bread"],
  ],
  verbs: [
    ["être", "to be"],
    ["avoir", "to have"],
    ["faire", "to do"],
    ["pouvoir", "to be able to"],
    ["vouloir", "to want"],
    ["aller", "to go"],
    ["savoir", "to know"],
    ["prendre", "to take"],
    ["venir", "to come"],
    ["voir", "to see"],
  ],
  adjectives: [
    ["grand", "big"],
    ["petit", "small"],
    ["beau", "beautiful"],
    ["jeune", "young"],
    ["nouveau", "new"],
    ["heureux", "happy"],
    ["difficile", "difficult"],
  ],
  adverbs: [
    ["toujours", "always"],
    ["souvent", "often"],
    ["jamais", "never"],
    ["vraiment", "really"],
  ],
  phrases: [
    ["ça vaut la peine", "it is worth it"],
    ["je m'en fiche", "I don't care"],
    ["tout le monde", "everybody"],
    ["à peu près", "roughly"],
    ["de temps en temps", "from time to time"],
  ],
  prepositions: [
    ["chez", "at the home of"],
    ["pendant", "during"],
    ["malgré", "despite"],
  ],
  conjunctions: [["parce que", "because"]],
  other: [],
};

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  runMigrations();

  const reset = process.argv.includes("--reset");

  let user = db.select().from(users).where(eq(users.email, EMAIL)).get();

  if (user && reset) {
    db.delete(users).where(eq(users.id, user.id)).run();
    user = undefined;
    console.log("Removed existing demo user.");
  }

  if (!user) {
    user = db
      .insert(users)
      .values({ email: EMAIL, passwordHash: await hashPassword(PASSWORD) })
      .returning()
      .get();
    console.log(`Created ${EMAIL}`);
  } else {
    console.log(`${EMAIL} already exists — topping up data.`);
  }

  let language = db
    .select()
    .from(languages)
    .where(eq(languages.userId, user.id))
    .get();

  if (!language) {
    language = db
      .insert(languages)
      .values({ userId: user.id, name: "French", code: "fr-FR" })
      .returning()
      .get();
  }

  const existingTypes = db
    .select()
    .from(wordTypes)
    .where(eq(wordTypes.languageId, language.id))
    .all();

  const typeByName = new Map(existingTypes.map((t) => [t.name, t]));

  let order = existingTypes.length;
  for (const name of Object.keys(VOCAB)) {
    if (!typeByName.has(name)) {
      const created = db
        .insert(wordTypes)
        .values({ languageId: language.id, name, sortOrder: order++ })
        .returning()
        .get();
      typeByName.set(name, created);
    }
  }

  let inserted = 0;

  for (const [typeName, entries] of Object.entries(VOCAB)) {
    const type = typeByName.get(typeName);
    if (!type) continue;

    for (const [term, english] of entries) {
      const created = db
        .insert(words)
        .values({ wordTypeId: type.id, term, english })
        .onConflictDoNothing()
        .returning()
        .get();

      if (!created) continue;
      inserted += 1;

      // Give most words a plausible history so the charts and the "learnt"
      // breakdown have something real to show. Roughly a fifth stay untouched.
      const roll = Math.random();
      if (roll < 0.2) continue;

      const strong = roll > 0.55;
      const tested = strong ? 6 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 3);
      const correct = strong ? tested : Math.max(1, tested - 1 - Math.floor(Math.random() * 2));
      const lastTested = daysAgo(Math.floor(Math.random() * (strong ? 6 : 40)));

      for (const dir of ["to_english", "from_english"] as const) {
        db.insert(progress)
          .values({
            wordId: created.id,
            mode: "written",
            direction: dir,
            tested,
            correct,
            streak: strong ? 3 : Math.floor(Math.random() * 3),
            lastTested,
          })
          .run();
      }

      db.insert(progress)
        .values({
          wordId: created.id,
          mode: "audio",
          direction: "listen",
          tested: Math.max(1, Math.floor(tested / 2)),
          correct: Math.max(1, Math.floor(correct / 2)),
          streak: strong ? 3 : 1,
          lastTested,
        })
        .run();

      // A few attempt rows per word so the activity chart is not empty.
      const attemptCount = Math.min(tested, 5);
      for (let i = 0; i < attemptCount; i += 1) {
        const when = new Date(Date.now() - Math.floor(Math.random() * 25) * 86_400_000);
        db.insert(attempts)
          .values({
            wordId: created.id,
            mode: "written",
            direction: i % 2 === 0 ? "to_english" : "from_english",
            correct: Math.random() > 0.18,
            answeredAt: when.toISOString(),
          })
          .run();
      }
    }
  }

  // Backdated history so the "over time" chart shows a trend.
  //
  // Calling recordSnapshot repeatedly would write the same numbers six times
  // (the underlying state never changes), giving flat lines. Instead, take the
  // real current figures and walk them backwards along a growth curve, so the
  // chart shows what the last two months would plausibly have looked like.
  const current = summariseByType(loadScoredWords(language.id, "written"), "written");
  const overall = summarise(loadScoredWords(language.id, "written"), "written");

  const offsets = [56, 49, 42, 35, 28, 21, 14, 10, 7, 4, 2];

  for (const offset of offsets) {
    const when = new Date(Date.now() - offset * 86_400_000).toISOString();
    // 0 at the far end, 1 at today — eased so early progress is slower.
    const t = Math.pow(1 - offset / 60, 1.6);

    const rows: (typeof statSnapshots.$inferInsert)[] = [
      {
        languageId: language.id,
        wordTypeId: null,
        mode: "written",
        takenAt: when,
        measure: "percentage_learnt",
        value: Math.round(overall.pctLearnt * t * 10) / 10,
      },
    ];

    for (const type of current) {
      // A little per-category jitter so the lines are not perfectly parallel.
      const wobble = 0.85 + ((type.wordTypeId * 37) % 30) / 100;
      rows.push({
        languageId: language.id,
        wordTypeId: type.wordTypeId,
        mode: "written",
        takenAt: when,
        measure: "percentage_learnt",
        value: Math.min(100, Math.round(type.pctLearnt * t * wobble * 10) / 10),
      });
    }

    db.insert(statSnapshots).values(rows).run();
  }

  // And a real snapshot for today, so the series ends on the true figure.
  recordSnapshot(language.id, "written");
  recordSnapshot(language.id, "audio");

  // The empty account: exists, but has no language and no words, so every
  // practice and insight page falls through to its empty state.
  const existingEmpty = db.select().from(users).where(eq(users.email, EMPTY_EMAIL)).get();
  if (existingEmpty && reset) {
    db.delete(users).where(eq(users.id, existingEmpty.id)).run();
  }
  if (!existingEmpty || reset) {
    const emptyUser = db
      .insert(users)
      .values({ email: EMPTY_EMAIL, passwordHash: await hashPassword(PASSWORD) })
      .returning()
      .get();

    // A language with categories but no words — the state a real user is in
    // right after signing up, and the one the "add some words" prompts target.
    const emptyLanguage = db
      .insert(languages)
      .values({ userId: emptyUser.id, name: "Spanish", code: "es-ES" })
      .returning()
      .get();

    db.insert(wordTypes)
      .values(
        ["nouns", "verbs", "adjectives", "phrases"].map((name, index) => ({
          languageId: emptyLanguage.id,
          name,
          sortOrder: index,
        })),
      )
      .run();

    console.log(`Created ${EMPTY_EMAIL} (language, no words — for empty states)`);
  }

  const total = db.select().from(words).all().length;

  console.log(`Language: ${language.name}`);
  console.log(`Words inserted this run: ${inserted} (total ${total})`);
  console.log(`\nSign in with:\n  ${EMAIL}\n  ${PASSWORD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
