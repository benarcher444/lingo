/**
 * Drives the conversation page end to end against the stand-in AI: the scene
 * and level picker, the AI opening, a corrected turn, speech (auto, replay,
 * slow, muted), the teacher thread with a follow-up, your own scene, and the
 * out-of-credit message.
 *
 *   AI_PROVIDER=mock npm start      # the server, with the stand-in (costs nothing)
 *   npx tsx scripts/test-chat.ts
 *
 * Needs the demo account seeded. Speech is recorded rather than played.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { allowlistPath } from "../src/allowlist.js";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";

// The demo account needs the AI switched on in allowed_emails.csv for this run.
// Put back as it was on the way out, however the run ends.
const listPath = allowlistPath();
const originalList = existsSync(listPath) ? readFileSync(listPath, "utf8") : null;
const listBase = originalList ?? "email,ai\n";
writeFileSync(listPath, `${listBase}${listBase.endsWith("\n") ? "" : "\n"}demo@lingo.local,yes\n`);
process.on("exit", () => {
  if (originalList === null) rmSync(listPath, { force: true });
  else writeFileSync(listPath, originalList);
});

/** Records utterances instead of speaking them. A string: see the __name trap. */
const RECORD_SPEECH = `(() => {
  window.__spoken = [];
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.speak = (u) => window.__spoken.push({ text: u.text, volume: u.volume, rate: u.rate });
})();`;

interface Spoken {
  text: string;
  volume: number;
  rate: number;
}

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(RECORD_SPEECH);
const page = await context.newPage();

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  // A refused request (the out-of-credit case) logs a 402 to the console; that is expected.
  if (m.type() === "error" && !/status of 40[0-9]/.test(m.text())) errors.push(m.text());
});

await page.goto(`${BASE}/login`);
await page.fill("#email", "demo@lingo.local");
await page.fill("#password", "demopassword");
await Promise.all([page.waitForURL((u) => !u.pathname.includes("/login")), page.click('button[type="submit"]')]);

const spoken = () => page.evaluate("window.__spoken") as Promise<Spoken[]>;
const audible = async () => (await spoken()).filter((s) => s.volume !== 0);
const tutorTexts = () => page.locator("#chat-log > .msg:not(.from-user) .bubble").allTextContents();
const lastTutor = async () => (await tutorTexts()).at(-1) ?? "";
const waitForTutor = (count: number) =>
  page.waitForFunction(
    `[...document.querySelectorAll("#chat-log > .msg:not(.from-user) .bubble")].filter(b => b.textContent !== "…").length >= ${count}`,
    undefined,
    { timeout: 10_000 },
  );

await page.goto(`${BASE}/practice/chat`, { waitUntil: "networkidle" });

console.log("\nSetup\n");

const scenes = await page.locator("#chat-scene option").allTextContents();
check("scenes on offer", scenes.length >= 10 && scenes.includes("General conversation") && scenes.includes("Surprise me"), `${scenes.length}`);
check("general conversation is the default", (await page.inputValue("#chat-scene")) === "general");
check("level starts at A1", (await page.inputValue("#chat-level")) === "A1");
check("own-scene box hidden until chosen", await page.locator("#chat-custom-field").isHidden());

console.log("\nThe AI opens\n");

await page.selectOption("#chat-scene", "restaurant");
await page.selectOption("#chat-level", "A2");
await page.click('#chat-setup button[type="submit"]');
await waitForTutor(1);

const opener = await lastTutor();
if (!opener.startsWith("[")) {
  console.log(`\nThe server is not using the stand-in AI (got "${opener.slice(0, 60)}").`);
  console.log("Start it with AI_PROVIDER=mock, then run this again.\n");
  await browser.close();
  process.exit(1);
}
check("it opens without being asked", opener.includes("Réponse 1"), `"${opener}"`);
check("in the chosen scene", opener.includes("At a restaurant"));
check("at the chosen level", opener.includes("A2"));
check("the setup gives way to the chat", (await page.locator("#chat-setup").isHidden()) && (await page.locator("#chat-form").isVisible()));
check("the header names scene and level", ((await page.textContent("#chat-sub")) ?? "").includes("At a restaurant · level A2"));

const afterOpen = await spoken();
check("a silent warm-up in the tap", afterOpen.some((s) => s.volume === 0));
check("the opener is read aloud", (await audible()).some((s) => s.text === opener));

console.log("\nA turn\n");

let before = (await audible()).length;
await page.fill("#chat-input", "je veux un cafe");
await page.press("#chat-input", "Enter");
await waitForTutor(3);

const corrected = await page.locator(".bubble-corrected").last().textContent();
check("the interpreter's correction is shown", corrected === "Corrigé : je veux un cafe", `"${corrected}"`);
check("then the partner replies", (await lastTutor()).includes("Réponse 2"), `"${await lastTutor()}"`);
const heard = (await audible()).slice(before).map((s) => s.text);
check("correction then reply, both read aloud, in order", heard.length === 2 && heard[0] === corrected && heard[1] === (await lastTutor()));

console.log("\nReplay, slow, mute\n");

before = (await audible()).length;
const lastMsg = page.locator("#chat-log > .msg:not(.from-user)").last();
await lastMsg.locator("button", { hasText: "Play" }).click();
await lastMsg.locator("button", { hasText: "Slow" }).click();
const replays = (await audible()).slice(before);
check("Play reads it again", replays[0]?.text === (await lastTutor()));
check("Slow reads it slower", (replays[1]?.rate ?? 1) < (replays[0]?.rate ?? 1));

await page.click("#chat-mute");
check("mute shows as on", (await page.getAttribute("#chat-mute", "aria-pressed")) === "true");
before = (await audible()).length;
await page.fill("#chat-input", "merci");
await page.press("#chat-input", "Enter");
await waitForTutor(5);
check("muted: nothing read aloud by itself", (await audible()).length === before);
await page.locator("#chat-log > .msg:not(.from-user)").last().locator("button", { hasText: "Play" }).click();
check("but Play still works", (await audible()).length === before + 1);
await page.click("#chat-mute");

console.log("\nThe teacher\n");

await page.locator("#chat-log > .msg:not(.from-user)").last().locator("button", { hasText: "Ask the teacher" }).click();
await page.waitForSelector(".teacher-thread .bubble-teach:not(:text('…'))", { timeout: 10_000 });
const first = await page.locator(".teacher-thread .bubble-teach").last().textContent();
check("it explains straight away", (first ?? "").startsWith("Explication 1"), `"${first}"`);
await page.fill(".teacher-ask input", "pourquoi ?");
await page.press(".teacher-ask input", "Enter");
await page.waitForFunction(
  `[...document.querySelectorAll(".teacher-thread .bubble-teach")].some(b => b.textContent.startsWith("Explication 2"))`,
  undefined,
  { timeout: 10_000 },
);
check("and answers a follow-up in the same thread", (await page.locator(".teacher-thread .bubble-teach").last().textContent())?.includes("pourquoi ?") ?? false);

console.log("\nOut of credit\n");

const userBubbles = await page.locator("#chat-log > .msg.from-user").count();
await page.fill("#chat-input", "!nocredit");
await page.press("#chat-input", "Enter");
await page.waitForSelector("#chat-log .bubble-error", { timeout: 10_000 });
const errorText = (await page.locator("#chat-log .bubble-error").last().textContent()) ?? "";
check("says plainly it has run out of credit", errorText.includes("run out of credit"), `"${errorText}"`);
check("and what to do about it", errorText.includes("Add credit"));
check("your text is back in the box", (await page.inputValue("#chat-input")) === "!nocredit");
check("and not left in the transcript", (await page.locator("#chat-log > .msg.from-user").count()) === userBubbles);

console.log("\nYour own scene\n");

await page.click("#chat-restart");
check("New returns to the setup", await page.locator("#chat-setup").isVisible());
await page.selectOption("#chat-scene", "custom");
check("the own-scene box appears", await page.locator("#chat-custom-field").isVisible());
await page.click('#chat-setup button[type="submit"]');
check("it will not start without a scene", await page.locator("#chat-setup").isVisible());
await page.fill("#chat-custom", "at the bank");
await page.click('#chat-setup button[type="submit"]');
await waitForTutor(1);
check("it opens in the learner's own scene", (await lastTutor()).includes("learner's own"), `"${await lastTutor()}"`);

await page.reload({ waitUntil: "networkidle" });
check("the level is remembered", (await page.inputValue("#chat-level")) === "A2");

if (errors.length > 0) {
  console.log(`\nConsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e}`);
  failures += 1;
}

console.log(`\n${failures === 0 ? "Conversation works." : `${failures} problem(s).`}\n`);

await browser.close();
if (failures > 0) process.exit(1);
