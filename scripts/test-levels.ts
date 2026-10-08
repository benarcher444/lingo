/**
 * The level briefs the tutor is held to. An A1 conversation once came back with
 * a conditional perfect, so "match your grammar to level A1" is not enough:
 * each level names what it may and may not use, and the prompts carry it.
 *
 *   npx tsx scripts/test-levels.ts
 */

import { LEVELS, LEVEL_RULES, levelBrief } from "../src/chat-scenarios.js";
import { composerPrompt } from "../src/sentences.js";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}\n         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

console.log("\nEvery level is spelled out");
for (const level of LEVELS) {
  check(`${level} has rules`, (LEVEL_RULES[level] ?? "").length > 80, true);
}

console.log("\nA1 rules out what tripped it up");
const a1 = LEVEL_RULES.A1.toLowerCase();
for (const banned of ["past", "future", "conditional", "subjunctive", "compound", "passive"]) {
  check(`A1 names ${banned}`, a1.includes(banned), true);
}
check("A1 allows the present", a1.includes("present tense only"), true);
check("A1 caps the sentence length", /at most \w+ words/.test(a1), true);

console.log("\nThe brief is an instruction, not a hint");
const brief = levelBrief("A1");
check("it names the level", brief.includes("level A1"), true);
check("it says the limit is hard", brief.includes("hard limit"), true);
check("it carries the rules", brief.includes(LEVEL_RULES.A1), true);
check("and asks for a re-read before sending", brief.toLowerCase().includes("re-read"), true);

console.log("\nB2 is looser than A1");
check("B2 allows the subjunctive", LEVEL_RULES.B2.toLowerCase().includes("subjunctive"), true);
check("without banning the past", LEVEL_RULES.B2.toLowerCase().includes("no past"), false);

console.log("\nTranslation practice is pitched the same way");
const composer = composerPrompt("Spanish", "A1");
check("the composer gets the brief too", composer.includes(LEVEL_RULES.A1), true);
check("and it names the language", composer.includes("Spanish"), true);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
