/**
 * Finds infinitive verbs filed under the wrong category and moves them.
 *
 *   npx tsx scripts/fix-verb-category.ts          # show what would move
 *   npx tsx scripts/fix-verb-category.ts --yes    # move them
 *
 * An English gloss starting with "to " is a reliable marker for an infinitive
 * ("to go", "to want"). Anything already in a verb category is left alone.
 *
 * Moving a word only changes which category it belongs to. Progress and
 * attempts are keyed on the word id, so learning history follows it across.
 */

import { and, eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";

const confirmed = process.argv.includes("--yes");

/** Category names that already hold verbs. */
const VERB_CATEGORIES = ["verbs", "verbs_infinitive", "infinitives"];

/** "to be" yes; "to the left" no — a second word that is not itself a noun phrase. */
function looksLikeInfinitive(english: string): boolean {
  const text = english.trim().toLowerCase();
  if (!text.startsWith("to ")) return false;

  const rest = text.slice(3).trim();
  if (!rest) return false;

  // "to the shop", "to a place" are prepositional, not infinitives.
  return !/^(the|a|an|my|your|his|her|its|our|their)\b/.test(rest);
}

interface Move {
  id: number;
  term: string;
  english: string;
  from: string;
  toTypeId: number;
  to: string;
  conflict: boolean;
}

const moves: Move[] = [];

for (const account of db.select().from(users).all()) {
  const langs = db.select().from(languages).where(eq(languages.userId, account.id)).all();

  for (const language of langs) {
    const types = db
      .select()
      .from(wordTypes)
      .where(eq(wordTypes.languageId, language.id))
      .all();

    const verbType = types.find((t) => VERB_CATEGORIES.includes(t.name.toLowerCase()));

    if (!verbType) {
      const hasAny = types.length > 0;
      if (hasAny) {
        console.log(`\n${language.name}: no verb category — nothing to move into.`);
      }
      continue;
    }

    for (const type of types) {
      if (type.id === verbType.id) continue;

      for (const row of db.select().from(words).where(eq(words.wordTypeId, type.id)).all()) {
        if (!looksLikeInfinitive(row.english)) continue;

        // (wordTypeId, term) is unique, so a duplicate in the target category
        // would make the update fail. Detect it rather than crash.
        const clash = db
          .select({ id: words.id })
          .from(words)
          .where(and(eq(words.wordTypeId, verbType.id), eq(words.term, row.term)))
          .get();

        moves.push({
          id: row.id,
          term: row.term,
          english: row.english,
          from: type.name,
          toTypeId: verbType.id,
          to: verbType.name,
          conflict: Boolean(clash),
        });
      }
    }
  }
}

if (moves.length === 0) {
  console.log("\nNo miscategorised verbs found.\n");
  process.exit(0);
}

console.log(`\n${moves.length} word(s) look like infinitive verbs in the wrong category:\n`);
for (const move of moves) {
  const note = move.conflict ? "  (already in the target category — will skip)" : "";
  console.log(
    `  ${String(move.id).padStart(4)}  ${move.term.padEnd(12)} ${move.english.padEnd(22)} ${move.from} -> ${move.to}${note}`,
  );
}

const movable = moves.filter((m) => !m.conflict);

if (!confirmed) {
  console.log(`\nNothing changed. Re-run with --yes to move ${movable.length}.\n`);
  process.exit(0);
}

for (const move of movable) {
  db.update(words).set({ wordTypeId: move.toTypeId }).where(eq(words.id, move.id)).run();
}

console.log(`\nMoved ${movable.length} word(s). Learning history is unchanged.\n`);
