/**
 * "I was right — count it" must turn the miss into a correct answer, not add
 * an answer of its own. It used to add a second, correct attempt and leave the
 * miss in place, so one question counted as tested twice, wrong once and right
 * once — which threw off every count and score it touched.
 *
 *   npx tsx scripts/test-override.ts
 *
 * Needs the server running and the demo account seeded.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { attempts, languages, progress, users } from "../src/db/schema.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

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

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

const language = db
  .select({ id: languages.id })
  .from(languages)
  .innerJoin(users, eq(users.id, languages.userId))
  .where(eq(users.email, "demo@lingo.local"))
  .get();
if (!language) {
  console.log("\nThe demo account has no language. Run npm run seed first.\n");
  process.exit(1);
}

const start = await post("/api/practice/start", { languageId: language.id, mode: "written", count: 1 });
const card = (start.data.cards as { wordId: number }[] | undefined)?.[0];
const sessionId = start.data.sessionId as string;
if (!card) {
  console.log("\nCould not start a session.\n");
  process.exit(1);
}

const direction = "to_english";
const where = and(eq(attempts.wordId, card.wordId), eq(attempts.mode, "written"), eq(attempts.direction, direction));
const answers = () => db.select().from(attempts).where(where).all();
const latest = () => db.select().from(attempts).where(where).orderBy(desc(attempts.answeredAt), desc(attempts.id)).get();
const row = () =>
  db
    .select()
    .from(progress)
    .where(and(eq(progress.wordId, card.wordId), eq(progress.mode, "written"), eq(progress.direction, direction)))
    .get();

/** The progress row must always be exactly what the answers add up to. */
const matchesAnswers = () => {
  const all = answers();
  const r = row();
  return Boolean(r) && r!.tested === all.length && r!.correct === all.filter((a) => a.correct).length;
};

const answer = (given: string, override = false) =>
  post("/api/practice/answer", { wordId: card.wordId, mode: "written", direction, answer: given, sessionId, override });

console.log("\nA miss\n");

const before = answers().length;
const miss = await answer("definitely wrong");
check("is marked wrong", miss.data.correct === false);
check("adds one answer", answers().length === before + 1);
check("and the counts match the answers", matchesAnswers(), JSON.stringify(row()));
check("the streak resets", row()?.streak === 0);

console.log("\nThen \"I was right\"\n");

const override = await answer("definitely wrong", true);
check("is marked right", override.data.correct === true);
check("adds no answer of its own", answers().length === before + 1, `${answers().length} vs ${before + 1}`);
check("it corrects the miss", latest()?.correct === true && latest()?.overridden === true);
check("keeping what was typed", latest()?.givenAnswer === "definitely wrong");
check("tested counts it once", matchesAnswers(), JSON.stringify(row()));
check("and the streak counts it", (row()?.streak ?? 0) >= 1);

console.log("\nPressing it again\n");

const snapshot = JSON.stringify(row());
const again = await answer("definitely wrong", true);
check("changes nothing", answers().length === before + 1 && JSON.stringify(row()) === snapshot, `status ${again.status}`);

console.log("\nAnswers afterwards\n");

await answer("definitely not it either");
const later = await answer("still not it");
check("count once each", answers().length === before + 3 && matchesAnswers(), `${answers().length}`);
check("and a miss after an override is still a miss", later.data.correct === false);
check("the corrected miss stays corrected", answers().filter((a) => a.overridden).length >= 1);

console.log(`\n${failures === 0 ? "Overrides count once." : `${failures} problem(s).`}\n`);
if (failures > 0) process.exit(1);
