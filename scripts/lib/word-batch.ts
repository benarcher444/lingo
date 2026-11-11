/**
 * The machinery behind a hand-written batch of vocabulary.
 *
 * A batch script is meant to be a *record* of what went in — a reviewable list
 * rather than rows that appeared in a database one day. So each script keeps
 * its own list and its own reasoning, and the part that is identical every
 * time lives here: find the account, apply the two duplicate guards, print what
 * would happen, back up, insert, and read it back.
 *
 * Two of the three guards decide what may go in, and both exist because a
 * question with two right answers records a real miss:
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
 * The third is about the shape of a batch rather than any one word. **At most
 * one verb infinitive per ten words going in**, because verb infinitives are
 * the hardest part of Spanish for the owner to learn and a run of them at once
 * overwhelms. Unlike the other two it refuses the **whole batch** rather than
 * skipping entries: which verbs to keep is a decision about what to study
 * next, so it belongs to the owner and not to a script picking the first few
 * off a list.
 *
 * Last there is a **report**, not a guard: a phrase whose own words are not in
 * the vocabulary has been memorised rather than understood, so every phrase
 * going in is broken into its words and the ones missing are printed. The
 * owner asked for this on 2026-11-11, having spotted `por ejemplo` sitting
 * there with no `el ejemplo` behind it.
 *
 * It reports rather than refuses, and the reason matters: some of a phrase's
 * words are **conjugated forms** — *lo siento* needs `siento`, *no entiendo*
 * needs `entiendo` — and conjugations are the owner's own curriculum, never
 * added unasked. A guard demanding them could not be satisfied without
 * breaking the rule above it. Articles are skipped as grammar rather than
 * vocabulary, and a word is counted as held if the vocabulary has its
 * singular or its masculine form.
 *
 * What no script can check is whether a new word is a *homophone* of one
 * already there: that is a question about sound, and the vocabulary only holds
 * spelling. Every batch needs that pass by hand, against the watch list in
 * CLAUDE.md, before it is run.
 *
 * Running a batch twice is safe: a word already in its category is left alone.
 */

import { eq } from "drizzle-orm";

import { databasePath, db, sqlite } from "../../src/db/index.js";
import { attempts, languages, users, wordTypes, words } from "../../src/db/schema.js";
import { spellingKey } from "../../src/routes/vocab.js";

export interface Entry {
  category: string;
  term: string;
  english: string;
}

/**
 * An entry a batch put in that no longer belongs where it was. Withdrawing one
 * is only ever a correction to that batch's own list, never a way to drop a
 * word the owner has been practising: a word with answers behind it is refused
 * and reported, because deleting it would take its history with it through the
 * schema's cascade.
 */
export interface Withdrawal {
  category: string;
  term: string;
  why: string;
}

export interface Batch {
  /** Path as it is typed, for the usage message. */
  script: string;
  words: Entry[];
  withdrawn?: Withdrawal[];
  /** Overridden with `--language=`. */
  language?: string;
}

/** Gloss already used anywhere in the language, whatever the spacing or case. */
const glossKey = (english: string) => english.trim().replace(/\s+/g, " ").toLowerCase();

/** The category the cap counts. Conjugated forms are not infinitives. */
const VERB_CATEGORY = "verbs";

/** Grammar rather than vocabulary: never reported as a missing phrase part. */
const ARTICLES = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas"]);

/** The words of a term, lower case, free of the punctuation a phrase carries. */
const partsOf = (term: string) =>
  term
    .toLowerCase()
    .replace(/[¿?¡!,.;:()"'’]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w));

/**
 * Forms of a word that count as the vocabulary already holding it: a plural
 * answered by its singular, a feminine by its masculine. `veces` needs the
 * `z` rule of its own — without it `la vez` looks absent behind *a veces*.
 */
const heldForms = (w: string) => {
  const forms = new Set([w]);
  if (w.endsWith("ces")) forms.add(`${w.slice(0, -3)}z`);
  if (w.endsWith("es")) forms.add(w.slice(0, -2));
  if (w.endsWith("s")) forms.add(w.slice(0, -1));
  if (w.endsWith("a")) forms.add(`${w.slice(0, -1)}o`);
  if (w.endsWith("as")) forms.add(`${w.slice(0, -2)}o`);
  if (w.endsWith("os")) forms.add(`${w.slice(0, -2)}o`);
  return [...forms];
};

/**
 * How many verb infinitives a batch of this size may carry: one per ten words,
 * counting what is actually going in rather than what the list says, so a
 * re-run that adds a single noun is judged on that noun.
 *
 * The floor means 25 words allow two verbs, not three — two whole tens. The
 * `max(1, …)` is so a batch smaller than ten can still carry one: three words
 * including a verb is not what overwhelms anybody, and refusing it would make
 * a one-word correction impossible.
 */
const verbsAllowedIn = (total: number) => Math.max(1, Math.floor(total / 10));

export async function runBatch(batch: Batch): Promise<void> {
  const apply = process.argv.includes("--apply");
  const emailArg = process.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length);
  const languageName =
    process.argv.find((a) => a.startsWith("--language="))?.slice("--language=".length) ??
    batch.language ??
    "Spanish";

  if (!emailArg) {
    console.error(
      "Which account? This adds words to one person's vocabulary, so it has to be named:\n" +
        `  npx tsx ${batch.script} --email=you@example.com`,
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

  const toWithdraw: { id: number; category: string; term: string; why: string }[] = [];
  const kept: Withdrawal[] = [];

  for (const entry of batch.withdrawn ?? []) {
    const found = existing.find(
      (w) =>
        w.category.toLowerCase() === entry.category.toLowerCase() &&
        spellingKey(w.term) === spellingKey(entry.term),
    );
    if (!found) continue;

    const answers = db.select().from(attempts).where(eq(attempts.wordId, found.id)).all().length;
    if (answers) {
      kept.push({ ...entry, why: `${answers} answer(s) behind it — left alone` });
      continue;
    }
    toWithdraw.push({ ...entry, id: found.id, term: found.term });
  }

  const withdrawnIds = new Set(toWithdraw.map((w) => w.id));
  const remaining = existing.filter((w) => !withdrawnIds.has(w.id));

  /** Spelling already used, per category: the app's own idea of a duplicate. */
  const spellingsByType = new Map<number, Set<string>>();
  for (const w of remaining) {
    const set = spellingsByType.get(w.wordTypeId) ?? new Set<string>();
    set.add(spellingKey(w.term));
    spellingsByType.set(w.wordTypeId, set);
  }

  /** Gloss already used, and by which word. */
  const byGloss = new Map<string, { term: string; category: string }>();
  for (const w of remaining) {
    byGloss.set(glossKey(w.english), { term: w.term, category: w.category });
  }

  const toAdd: { entry: Entry; wordTypeId: number }[] = [];
  const already: Entry[] = [];
  const refused: { entry: Entry; why: string }[] = [];

  for (const entry of batch.words) {
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
    console.log(`  + ${entry.category.padEnd(13)} ${entry.term.padEnd(26)} ${entry.english}`);
  }
  for (const entry of already) {
    console.log(`  = ${entry.category.padEnd(13)} ${entry.term.padEnd(26)} already there`);
  }
  for (const w of toWithdraw) {
    console.log(`  - ${w.category.padEnd(13)} ${w.term.padEnd(26)} ${w.why}`);
  }
  for (const { entry, why } of [...refused, ...kept.map((k) => ({ entry: k, why: k.why }))]) {
    console.log(`  ! ${entry.category.padEnd(13)} ${entry.term.padEnd(26)} ${why}`);
  }

  console.log(
    `\n${toAdd.length} to add, ${toWithdraw.length} to withdraw, ${already.length} already there, ` +
      `${refused.length + kept.length} refused` +
      ` — ${existing.length} → ${existing.length + toAdd.length - toWithdraw.length} words.`,
  );

  if (!toAdd.length && !toWithdraw.length) {
    console.log("Nothing to do.");
    process.exit(refused.length ? 1 : 0);
  }

  // Phrases whose own words are not in the vocabulary. A report, not a guard
  // — see the header for why it cannot be one.
  //
  // The vocabulary of *words* is the single-word entries alone. A multi-word
  // entry is a phrase, and a phrase is not evidence that its parts are known
  // — which is the entire point of the check. Seeding this from the parts of
  // every term instead let each phrase supply its own words and report
  // nothing, which is how it was first written.
  const asWord = (term: string) => {
    const parts = partsOf(term);
    return parts.length === 1 ? parts[0] : null;
  };
  const vocabulary = new Set<string>();
  for (const w of [...remaining.map((w) => w.term), ...toAdd.map((a) => a.entry.term)]) {
    const one = asWord(w);
    if (one) vocabulary.add(one);
  }

  const undecomposed = toAdd
    .filter(({ entry }) => partsOf(entry.term).length > 1)
    .map(({ entry }) => ({
      entry,
      gaps: partsOf(entry.term).filter((p) => !heldForms(p).some((f) => vocabulary.has(f))),
    }))
    .filter((r) => r.gaps.length);

  if (undecomposed.length) {
    console.log("\nPhrases going in whose own words are not in the vocabulary:");
    for (const { entry, gaps } of undecomposed) {
      console.log(`  ? ${entry.term.padEnd(26)} needs ${gaps.join(", ")}`);
    }
    console.log(
      "  A phrase you cannot take apart has been memorised rather than understood.\n" +
        "  Add the words it is made of, unless they are conjugated forms — those are\n" +
        "  the owner's to ask for.",
    );
  }

  // The verb cap, checked after the plan is printed so the batch can be seen
  // before it is turned away, and before anything is backed up or written.
  const verbs = toAdd.filter(({ entry }) => entry.category.toLowerCase() === VERB_CATEGORY);
  const allowed = verbsAllowedIn(toAdd.length);
  if (verbs.length > allowed && !process.argv.includes("--verbs-ok")) {
    console.error(
      `\nRefused: ${verbs.length} verb infinitives in ${toAdd.length} words, and the cap is ` +
        `${allowed} — one per ten.\n  ${verbs.map((v) => v.entry.term).join(", ")}\n\n` +
        "Verb infinitives are the hardest part of the language to learn and too many at\n" +
        `once overwhelms, so keep ${allowed} and leave the rest for a later batch. Which ones\n` +
        "to keep is the owner's call, not this script's.\n\n" +
        "If the owner asked for verbs by name, pass --verbs-ok.",
    );
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to make these changes.");
    process.exit(0);
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const target = `${databasePath.replace(/\.db$/, "")}-pre-add-${stamp}.db`;
  await sqlite.backup(target);
  console.log(`\nBacked up ${databasePath} → ${target}`);

  for (const w of toWithdraw) {
    db.delete(words).where(eq(words.id, w.id)).run();
  }

  if (toAdd.length) {
    db.insert(words)
      .values(
        toAdd.map(({ entry, wordTypeId }) => ({
          wordTypeId,
          term: entry.term,
          english: entry.english,
        })),
      )
      .run();
  }

  // Read it back rather than trust the insert count.
  const after = types.flatMap((type) =>
    db.select().from(words).where(eq(words.wordTypeId, type.id)).all(),
  );
  const present = new Set(after.map((w) => `${w.wordTypeId}:${spellingKey(w.term)}`));
  const missing = toAdd.filter(
    ({ entry, wordTypeId }) => !present.has(`${wordTypeId}:${spellingKey(entry.term)}`),
  );
  const goneNow = toWithdraw.filter((w) => !db.select().from(words).where(eq(words.id, w.id)).get());

  console.log(
    `Applied. ${toAdd.length - missing.length}/${toAdd.length} added, ` +
      `${goneNow.length}/${toWithdraw.length} withdrawn, ${after.length} words now.`,
  );

  if (missing.length) {
    console.error(`Not added: ${missing.map((m) => m.entry.term).join(", ")}`);
    process.exit(1);
  }
}
