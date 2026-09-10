/**
 * Checks that a word already in the language cannot be added again, or made by
 * renaming another word, whatever its case, spacing or category. Accents still
 * make a different word.
 *
 *   npx tsx scripts/test-duplicates.ts
 *
 * Needs the server running and the demo account seeded. Every word it adds is
 * removed again, even if a check fails.
 */

import { eq, inArray } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { languages, users, wordTypes, words } from "../src/db/schema.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const stamp = Date.now();
const TERM = `zz dup ${stamp}`;
const ACCENTED = `zz dúp ${stamp}`;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const login = await fetch(`${BASE}/login`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ email: "demo@lingo.local", password: "demopassword" }),
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
if (!cookie.startsWith("ll_session=")) {
  console.log("\nCould not sign in as the demo account. Run npm run seed first.\n");
  process.exit(1);
}

// Two categories of the demo account's first language.
const demoTypes = db
  .select({ id: wordTypes.id, name: wordTypes.name, languageId: wordTypes.languageId })
  .from(wordTypes)
  .innerJoin(languages, eq(languages.id, wordTypes.languageId))
  .innerJoin(users, eq(users.id, languages.userId))
  .where(eq(users.email, "demo@lingo.local"))
  .all();
const sameLanguage = demoTypes.filter((t) => t.languageId === demoTypes[0]?.languageId);
const [first, second] = sameLanguage;
if (!first || !second) {
  console.log("\nThe demo account needs two categories in one language. Run npm run seed.\n");
  process.exit(1);
}

const add = (term: string, wordTypeId: number) =>
  fetch(`${BASE}/api/words`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ term, english: "test", wordTypeId, writtenEnabled: true, audioEnabled: true }),
  });

const save = (id: number, term: string, english: string, wordTypeId: number) =>
  fetch(`${BASE}/words/${id}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-requested-with": "fetch",
      cookie,
    },
    body: new URLSearchParams({
      term,
      english,
      wordTypeId: String(wordTypeId),
      writtenEnabled: "on",
      audioEnabled: "on",
    }),
  });

const idOf = (term: string) => db.select().from(words).where(eq(words.term, term)).get()?.id;

try {
  console.log("\nAdding\n");

  const original = await add(TERM, first.id);
  check("a new word is added", original.status === 200, `status ${original.status}`);

  const again = await add(TERM, first.id);
  const againBody = (await again.json()) as { error?: string };
  check("the same word again is refused", again.status === 409, `status ${again.status}`);
  check("and the message names the existing entry", (againBody.error ?? "").includes(TERM), againBody.error);

  const shouted = await add(`  ${TERM.toUpperCase().replace(" ", "   ")}  `, first.id);
  check("different case and spacing are the same word", shouted.status === 409, `status ${shouted.status}`);

  const elsewhere = await add(TERM, second.id);
  check(`another category (${second.name}) is still a duplicate`, elsewhere.status === 409, `status ${elsewhere.status}`);

  const accented = await add(ACCENTED, first.id);
  check("an accent makes a different word", accented.status === 200, `status ${accented.status}`);

  const form = await fetch(`${BASE}/words`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ term: TERM, english: "test", wordTypeId: String(first.id) }),
  });
  check(
    "the plain form refuses it too",
    (form.headers.get("location") ?? "").includes("error=duplicate"),
    form.headers.get("location") ?? "",
  );

  console.log("\nRenaming\n");

  const accentedId = idOf(ACCENTED)!;
  const rename = await save(accentedId, TERM, "test", first.id);
  check("renaming onto an existing spelling is refused", rename.status === 409, `status ${rename.status}`);
  check("and the word keeps its name", idOf(ACCENTED) === accentedId);

  const keep = await save(idOf(TERM)!, TERM, "a new meaning", first.id);
  check("saving a word under its own spelling is fine", keep.status === 200, `status ${keep.status}`);
} finally {
  db.delete(words).where(inArray(words.term, [TERM, ACCENTED])).run();
}

check("test words removed", idOf(TERM) === undefined && idOf(ACCENTED) === undefined);

console.log(`\n${failures === 0 ? "Duplicates are blocked." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
