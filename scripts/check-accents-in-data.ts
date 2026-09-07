/**
 * Flags stored words that may be missing an accent.
 *
 *   npx tsx scripts/check-accents-in-data.ts
 *
 * Evidence, not guesswork: the archived vocabulary in old_code_repo holds a few
 * thousand correctly-accented French and Spanish words. Strip the accents from
 * both sides and compare — if a stored word matches an archived one that does
 * carry accents, and the two differ, the stored spelling is probably wrong.
 *
 * Read-only. It reports; it does not change anything.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";

import { deaccent } from "../src/algorithm.js";
import { db } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";

const ARCHIVE = join(process.cwd(), "old_code_repo", "data");

/** deaccented form -> the accented spellings seen in the archive. */
function loadReference(languageName: string): Map<string, Set<string>> {
  const reference = new Map<string, Set<string>>();
  const folder = join(ARCHIVE, languageName.toLowerCase());
  if (!existsSync(folder)) return reference;

  for (const file of readdirSync(folder).filter((f) => f.endsWith(".csv"))) {
    const text = readFileSync(join(folder, file), "utf8");
    const lines = text.split(/\r?\n/);
    const header = (lines[0] ?? "").split(",");
    const termColumn = header.findIndex(
      (h) => h.trim().toLowerCase() === languageName.toLowerCase(),
    );
    if (termColumn === -1) continue;

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      // Terms here never contain commas, so a plain split is safe.
      const term = (line.split(",")[termColumn] ?? "").trim();
      if (!term) continue;

      const key = deaccent(term).toLowerCase();
      const bucket = reference.get(key) ?? new Set<string>();
      bucket.add(term);
      reference.set(key, bucket);
    }
  }

  return reference;
}

let flagged = 0;
let checked = 0;
let matched = 0;

for (const account of db.select().from(users).all()) {
  const langs = db.select().from(languages).where(eq(languages.userId, account.id)).all();

  for (const language of langs) {
    const reference = loadReference(language.name);

    console.log(`\n${account.email} — ${language.name}`);
    console.log(`  archive holds ${reference.size} reference spellings`);

    if (reference.size === 0) {
      console.log("  no archived vocabulary for this language, skipping");
      continue;
    }

    const types = db
      .select()
      .from(wordTypes)
      .where(eq(wordTypes.languageId, language.id))
      .all();

    for (const type of types) {
      for (const row of db.select().from(words).where(eq(words.wordTypeId, type.id)).all()) {
        checked += 1;

        const key = deaccent(row.term).toLowerCase();
        const candidates = reference.get(key);
        if (!candidates) continue;

        matched += 1;

        // Case-insensitive: only a difference in accents matters here.
        const exact = [...candidates].some(
          (candidate) => candidate.toLowerCase() === row.term.toLowerCase(),
        );
        if (exact) continue;

        // Only report when the archive spelling actually carries an accent.
        const accented = [...candidates].filter((c) => deaccent(c) !== c);
        if (accented.length === 0) continue;

        flagged += 1;
        console.log(
          `  ${String(row.id).padStart(4)}  "${row.term}"  ->  probably "${accented.join('" or "')}"  [${type.name}]`,
        );
      }
    }
  }
}

console.log(`\nChecked ${checked} words, ${matched} found in the archive, ${flagged} look wrong.`);
if (flagged === 0) console.log("No missing accents found.\n");
else console.log("");
