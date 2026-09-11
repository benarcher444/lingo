/**
 * Repairs the overrides recorded before "I was right — count it" was fixed.
 *
 * It used to add a second, correct answer straight after the miss and leave
 * the miss in place, so every override counted as two answers, one wrong and
 * one right: times tested went up by two, accuracy down, and the streak broke.
 * This merges each one into the miss it corrected, which is how the fixed code
 * records it, then brings everything built on those answers into line:
 *
 *   - the counts behind every word's score (tested, correct, streak)
 *   - the history behind the Progress chart (stat_snapshots)
 *
 * The daily activity chart and the word records read the answers directly, so
 * they are right as soon as the answers are.
 *
 *   npx tsx scripts/fix-overrides.ts --before=2026-09-11T10:15:00Z           # dry run
 *   npx tsx scripts/fix-overrides.ts --before=2026-09-11T10:15:00Z --apply   # back up, then change
 *
 * --before is when the fixed code started. From then on an override is stored
 * as a corrected miss, which looks just like an old override row, so only
 * answers from before then are merged. On the server:
 *
 *   systemctl show lingo -p ActiveEnterTimestamp
 *
 * It will not apply twice: a marker file next to the database records the run,
 * because a second pass would take corrected misses for old overrides.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { asc, eq, inArray } from "drizzle-orm";

import {
  MODE_DIRECTIONS,
  isCompletelyLearnt,
  isLearnt,
  mergeOverrides,
  normaliseAnswer,
  scoreWord,
  tallyAnswers,
  today,
  type Mode,
} from "../src/algorithm.js";
import { databasePath, db, sqlite } from "../src/db/index.js";
import { attempts, languages, progress, statSnapshots, wordTypes, words } from "../src/db/schema.js";

type Answer = typeof attempts.$inferSelect;
type Snapshot = typeof statSnapshots.$inferSelect;

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");

const beforeArg = arg("before");
if (!beforeArg || Number.isNaN(Date.parse(beforeArg))) {
  console.error("Pass --before=<when the fixed code started>, e.g. --before=2026-09-11T10:15:00Z");
  process.exit(1);
}
const before = new Date(beforeArg).toISOString();

const marker = join(dirname(databasePath), "override-fix.done");
if (existsSync(marker)) {
  console.error(`Already applied — see ${marker}. A second pass would undo corrected misses.`);
  process.exit(1);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sameCounts = (a: { tested: number; correct: number; streak: number }, b: typeof a) =>
  a.tested === b.tested && a.correct === b.correct && a.streak === b.streak;

/* ------------------------------------------------------------------
   Load
   ------------------------------------------------------------------ */

const allAnswers = db.select().from(attempts).orderBy(asc(attempts.id)).all();
const answerById = new Map(allAnswers.map((a) => [a.id, a]));

const wordRows = db
  .select({
    id: words.id,
    term: words.term,
    english: words.english,
    typeId: words.wordTypeId,
    languageId: wordTypes.languageId,
    language: languages.name,
    writtenEnabled: words.writtenEnabled,
    audioEnabled: words.audioEnabled,
    createdAt: words.createdAt,
  })
  .from(words)
  .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
  .innerJoin(languages, eq(languages.id, wordTypes.languageId))
  .all();
const wordById = new Map(wordRows.map((w) => [w.id, w]));

const group = <K>(rows: Answer[], keyOf: (a: Answer) => K) => {
  const out = new Map<K, Answer[]>();
  for (const row of rows) {
    const k = keyOf(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
};

const byCard = group(allAnswers, (a) => `${a.wordId}|${a.mode}|${a.direction}`);
const byWordMode = group(allAnswers, (a) => `${a.wordId}|${a.mode}`);

/* ------------------------------------------------------------------
   Merge each old override into the miss it corrected
   ------------------------------------------------------------------ */

const flips = new Set<number>();
const removes = new Set<number>();
const unmatched: Answer[] = [];

for (const rows of byCard.values()) {
  const old = rows.filter((r) => r.answeredAt < before);
  const result = mergeOverrides(old.map(({ id, correct, overridden }) => ({ id, correct, overridden })));
  for (const id of result.flip) flips.add(id);
  for (const id of result.remove) removes.add(id);
  for (const id of result.unmatched) unmatched.push(answerById.get(id)!);
}

/** The answers as the fixed code would have recorded them. */
const merged = (rows: Answer[]): Answer[] =>
  rows
    .filter((r) => !removes.has(r.id))
    .map((r) => (flips.has(r.id) ? { ...r, correct: true, overridden: true } : r));

/* ------------------------------------------------------------------
   Progress rows: tested, correct, streak
   ------------------------------------------------------------------ */

const progressRows = db.select().from(progress).all();
const inconsistent: string[] = [];
const progressChanges: { row: typeof progress.$inferSelect; fixed: ReturnType<typeof tallyAnswers> }[] = [];

for (const row of progressRows) {
  const rows = byCard.get(`${row.wordId}|${row.mode}|${row.direction}`) ?? [];

  // Every count so far was built one answer at a time, so it should equal the
  // answers as they stand. Anything that does not is left alone and listed.
  if (!sameCounts(tallyAnswers(rows.map((r) => r.correct)), row)) {
    inconsistent.push(`${wordById.get(row.wordId)?.term ?? row.wordId} ${row.mode}/${row.direction}`);
    continue;
  }

  const fixed = tallyAnswers(merged(rows).map((r) => r.correct));
  if (!sameCounts(fixed, row)) progressChanges.push({ row, fixed });
}

/* ------------------------------------------------------------------
   Progress chart history
   ------------------------------------------------------------------ */

// Only words with a merged override can have a different history. For each
// snapshot, replay those words to that moment both ways and apply the
// difference to what was stored — rather than recomputing the snapshot from
// scratch, which would also need every word as it was then, including any
// since deleted or moved.

const affected = new Set<string>();
for (const id of removes) {
  const a = answerById.get(id)!;
  affected.add(`${a.wordId}|${a.mode}`);
}

/** A word's standing at a moment, from its answers up to then. */
function standing(rows: Answer[], mode: Mode, at: string) {
  const upTo = rows.filter((r) => r.answeredAt < at);
  if (upTo.length === 0) return null;

  const directions = MODE_DIRECTIONS[mode]
    .map((direction) => ({
      direction,
      ...tallyAnswers(upTo.filter((r) => r.direction === direction).map((r) => r.correct)),
    }))
    .filter((d) => d.tested > 0);

  const tested = directions.reduce((sum, d) => sum + d.tested, 0);
  const correct = directions.reduce((sum, d) => sum + d.correct, 0);
  const lastTested = today(new Date(upTo.at(-1)!.answeredAt));

  return {
    score: scoreWord({ directions, lastTested }, mode, new Date(at)),
    accuracy: tested > 0 ? (100 * correct) / tested : 0,
  };
}

const snapshots = db.select().from(statSnapshots).all();
const snapshotGroups = new Map<string, Map<string, Snapshot>>();
const moments = new Map<string, { languageId: number; mode: Mode; takenAt: string }>();

for (const s of snapshots) {
  const moment = `${s.languageId}|${s.mode}|${s.takenAt}`;
  moments.set(moment, { languageId: s.languageId, mode: s.mode as Mode, takenAt: s.takenAt });
  const key = `${moment}|${s.wordTypeId ?? "all"}`;
  const measures = snapshotGroups.get(key) ?? new Map<string, Snapshot>();
  measures.set(s.measure, s);
  snapshotGroups.set(key, measures);
}

interface Delta {
  score: number;
  accuracy: number;
  learnt: number;
  solid: number;
}
const deltas = new Map<string, Delta>();
const addDelta = (key: string, d: Delta) => {
  const sum = deltas.get(key) ?? { score: 0, accuracy: 0, learnt: 0, solid: 0 };
  sum.score += d.score;
  sum.accuracy += d.accuracy;
  sum.learnt += d.learnt;
  sum.solid += d.solid;
  deltas.set(key, sum);
};

for (const [momentKey, moment] of moments) {
  for (const wordMode of affected) {
    const [wordIdText, mode] = wordMode.split("|") as [string, Mode];
    if (mode !== moment.mode) continue;

    const word = wordById.get(Number(wordIdText));
    if (!word || word.languageId !== moment.languageId || word.createdAt > moment.takenAt) continue;
    if (!(mode === "audio" ? word.audioEnabled : word.writtenEnabled)) continue;

    const rows = byWordMode.get(wordMode)!;
    const was = standing(rows, mode, moment.takenAt);
    const is = standing(merged(rows), mode, moment.takenAt);
    if (!was || !is) continue;

    const d: Delta = {
      score: is.score - was.score,
      accuracy: is.accuracy - was.accuracy,
      learnt: Number(isLearnt(is.score)) - Number(isLearnt(was.score)),
      solid: Number(isCompletelyLearnt(is.score)) - Number(isCompletelyLearnt(was.score)),
    };
    addDelta(`${momentKey}|all`, d);
    addDelta(`${momentKey}|${word.typeId}`, d);
  }
}

const snapshotChanges: { row: Snapshot; to: number }[] = [];

for (const [key, d] of deltas) {
  const measures = snapshotGroups.get(key);
  const total = measures?.get("total_words")?.value;
  if (!measures || !total) continue;

  const value = (measure: string) => measures.get(measure)?.value;
  const set = (measure: string, to: number) => {
    const row = measures.get(measure);
    if (row && Math.abs(row.value - to) > 1e-9) snapshotChanges.push({ row, to });
  };

  const learnt = value("words_learnt");
  const solid = value("words_completely_learnt");
  const tested = total - (value("new_words") ?? 0);

  if (learnt !== undefined) {
    set("words_learnt", learnt + d.learnt);
    set("percentage_learnt", round2((100 * (learnt + d.learnt)) / total));
  }
  if (solid !== undefined) {
    set("words_completely_learnt", solid + d.solid);
    set("percentage_completely_learnt", round2((100 * (solid + d.solid)) / total));
  }
  const notSolid = value("words_learnt_not_solid");
  if (notSolid !== undefined) set("words_learnt_not_solid", notSolid + d.learnt - d.solid);
  const learning = value("words_learning");
  if (learning !== undefined) set("words_learning", learning - d.learnt);
  const score = value("average_score");
  if (score !== undefined) set("average_score", round2(score + d.score / total));
  const accuracy = value("average_accuracy");
  if (accuracy !== undefined && tested > 0) set("average_accuracy", round2(accuracy + d.accuracy / tested));
}

// How far to trust the replay: rebuild each stored snapshot in full from the
// answers as they stand, and compare with what was recorded at the time. A
// snapshot taken before a word was deleted or switched off cannot match, so
// not every one will — but most should.
let reproduced = 0;
let compared = 0;

for (const [momentKey, moment] of moments) {
  const measures = snapshotGroups.get(`${momentKey}|all`);
  const storedTotal = measures?.get("total_words")?.value;
  const storedLearnt = measures?.get("words_learnt")?.value;
  const storedScore = measures?.get("average_score")?.value;
  if (storedTotal === undefined || storedLearnt === undefined || storedScore === undefined) continue;

  const inPlay = wordRows.filter(
    (w) =>
      w.languageId === moment.languageId &&
      w.createdAt <= moment.takenAt &&
      (moment.mode === "audio" ? w.audioEnabled : w.writtenEnabled),
  );
  let learnt = 0;
  let scoreSum = 0;
  for (const w of inPlay) {
    const s = standing(byWordMode.get(`${w.id}|${moment.mode}`) ?? [], moment.mode, moment.takenAt);
    if (!s) continue;
    scoreSum += s.score;
    if (isLearnt(s.score)) learnt += 1;
  }

  compared += 1;
  if (
    inPlay.length === storedTotal &&
    learnt === storedLearnt &&
    inPlay.length > 0 &&
    round2(scoreSum / inPlay.length) === storedScore
  ) {
    reproduced += 1;
  }
}

/* ------------------------------------------------------------------
   Report
   ------------------------------------------------------------------ */

const overridesBefore = allAnswers.filter((a) => a.overridden && a.answeredAt < before).length;
const describe = (a: Answer) => {
  const word = wordById.get(a.wordId);
  const wanted = a.direction === "from_english" ? word?.term : word?.english;
  return `#${a.id} ${a.answeredAt.slice(0, 16).replace("T", " ")}  ${a.mode}/${a.direction}  typed "${a.givenAnswer}" for "${wanted}"`;
};

console.log(`\nAnswers: ${allAnswers.length}. Overrides recorded the old way (before ${before}): ${overridesBefore}.`);
console.log(`  misses to mark right:        ${flips.size}`);
console.log(`  extra rows to delete:        ${removes.size}`);
console.log(`  of which a second press:     ${removes.size - flips.size - unmatched.length}`);
console.log(`  overrides after a right answer (deleted too): ${unmatched.length}`);
for (const a of unmatched) console.log(`    ${describe(a)}`);

console.log(`\nWord counts: ${progressRows.length} rows, ${progressChanges.length} to correct.`);
if (inconsistent.length > 0) {
  console.log(`  ${inconsistent.length} did not match their answers even before the fix, and are left alone:`);
  for (const line of inconsistent.slice(0, 20)) console.log(`    ${line}`);
}

const changesByWord = new Map<number, typeof progressChanges>();
for (const change of progressChanges) {
  const list = changesByWord.get(change.row.wordId) ?? [];
  list.push(change);
  changesByWord.set(change.row.wordId, list);
}
const lines = [...changesByWord.entries()]
  .map(([wordId, changes]) => ({
    word: wordById.get(wordId)!,
    removed: changes.reduce((sum, c) => sum + c.row.tested - c.fixed.tested, 0),
    changes,
  }))
  .sort((a, b) => b.removed - a.removed || a.word.term.localeCompare(b.word.term));

const counts = (c: { tested: number; correct: number; streak: number }) =>
  `tested ${c.tested}, right ${c.correct}, streak ${c.streak}`;
const detail = (entry: (typeof lines)[number]) => {
  console.log(`  ${entry.word.term} (${entry.word.language})`);
  for (const { row, fixed } of entry.changes) {
    console.log(`    ${row.mode}/${row.direction}: ${counts(row)}  ->  ${counts(fixed)}`);
  }
};

console.log(`\nMost affected:`);
for (const entry of lines.slice(0, 15)) detail(entry);

for (const wanted of ["pres", "la fin"]) {
  const matches = wordRows.filter((w) => normaliseAnswer(w.term) === wanted);
  for (const word of matches) {
    console.log(`\n${word.term} (${word.language}) in full:`);
    const rows = allAnswers.filter((a) => a.wordId === word.id);
    for (const a of rows) {
      const note = flips.has(a.id) ? "  <- marked right" : removes.has(a.id) ? "  <- deleted (the extra row)" : "";
      console.log(`  ${describe(a)}  ${a.correct ? "right" : "WRONG"}${a.overridden ? " (override)" : ""}${note}`);
    }
    const entry = lines.find((l) => l.word.id === word.id);
    if (entry) detail(entry);
  }
}

console.log(`\nProgress chart history: ${snapshots.length} stored values, ${snapshotChanges.length} to correct.`);
console.log(`  replaying the answers reproduces ${reproduced} of ${compared} snapshots exactly (word count, words learnt, average score)`);
const latestOverall = [...moments.entries()]
  .sort((a, b) => b[1].takenAt.localeCompare(a[1].takenAt))
  .filter(([, m], i, all) => all.findIndex(([, o]) => o.languageId === m.languageId && o.mode === m.mode) === i);
for (const [momentKey, moment] of latestOverall) {
  const measures = snapshotGroups.get(`${momentKey}|all`);
  const shown = ["words_learnt", "average_score", "average_accuracy"]
    .map((measure) => {
      const row = measures?.get(measure);
      if (!row) return null;
      const change = snapshotChanges.find((c) => c.row.id === row.id);
      return `${measure} ${row.value}${change ? ` -> ${change.to}` : " (unchanged)"}`;
    })
    .filter(Boolean);
  const language = wordRows.find((w) => w.languageId === moment.languageId)?.language ?? moment.languageId;
  console.log(`  latest ${language} ${moment.mode} (${moment.takenAt.slice(0, 16)}): ${shown.join(", ")}`);
}

if (!apply) {
  console.log("\nDry run: nothing changed. Add --apply to back up the database and make these changes.\n");
  process.exit(0);
}

/* ------------------------------------------------------------------
   Apply
   ------------------------------------------------------------------ */

const backupDir = join(dirname(databasePath), "backups");
mkdirSync(backupDir, { recursive: true });
const backupPath = join(backupDir, `pre-override-fix-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.db`);
await sqlite.backup(backupPath);
console.log(`\nBacked up to ${backupPath}`);

db.transaction(() => {
  if (flips.size > 0) {
    db.update(attempts)
      .set({ correct: true, overridden: true })
      .where(inArray(attempts.id, [...flips]))
      .run();
  }
  if (removes.size > 0) db.delete(attempts).where(inArray(attempts.id, [...removes])).run();
  for (const { row, fixed } of progressChanges) {
    db.update(progress).set(fixed).where(eq(progress.id, row.id)).run();
  }
  for (const { row, to } of snapshotChanges) {
    db.update(statSnapshots).set({ value: to }).where(eq(statSnapshots.id, row.id)).run();
  }
});

writeFileSync(marker, `Applied ${new Date().toISOString()}, merging overrides before ${before}. Backup: ${backupPath}\n`);

// Check the result the same way the fixed code keeps it: every word's counts
// are exactly what its answers add up to.
const after = group(db.select().from(attempts).orderBy(asc(attempts.id)).all(), (a) => `${a.wordId}|${a.mode}|${a.direction}`);
const mismatched = db
  .select()
  .from(progress)
  .all()
  .filter((row) => !sameCounts(tallyAnswers((after.get(`${row.wordId}|${row.mode}|${row.direction}`) ?? []).map((r) => r.correct)), row));

console.log(`Done. ${flips.size} misses marked right, ${removes.size} extra rows deleted, ${progressChanges.length} word counts and ${snapshotChanges.length} chart values corrected.`);
console.log(`Word counts that now match their answers: ${progressRows.length - mismatched.length} of ${progressRows.length}.\n`);
