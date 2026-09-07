/**
 * Removes words left behind by scripts/test-fast-entry.ts, which stamps each
 * term with a 5-digit run id so repeat runs do not collide.
 *
 *   npx tsx scripts/clean-test-words.ts
 */

import { db } from "../src/db/index.js";
import { words } from "../src/db/schema.js";
import { inArray } from "drizzle-orm";

const rows = db.select({ id: words.id, term: words.term }).from(words).all();
const junk = rows.filter((r) => /\s\d{5}$/.test(r.term));

console.log(`Total words: ${rows.length}`);

if (junk.length === 0) {
  console.log("No test words to remove.");
} else {
  db.delete(words)
    .where(inArray(words.id, junk.map((r) => r.id)))
    .run();
  console.log(`Removed ${junk.length}: ${junk.map((r) => r.term).join(", ")}`);
}
