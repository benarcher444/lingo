/**
 * The level briefs the tutor is held to. An A1 conversation once came back with
 * a conditional perfect, so "match your grammar to level A1" is not enough:
 * each level names what it may and may not use, and the prompts carry it.
 *
 *   npx tsx scripts/test-levels.ts
 */

import { LEVELS, LEVEL_RULES, levelBrief } from "../src/chat-scenarios.js";
import { composerPrompt, markerPrompt, missingWords, parseJson } from "../src/sentences.js";

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

// It once wrote "we spoke in black and sad about how to go to the party":
// five words forced into one clause, in the order they were listed.
console.log("\nThe composer is told how to use the words");
const rules = composer.toLowerCase();
check("any order, not the order given", rules.includes("in any order"), true);
check("more than one sentence is allowed", rules.includes("one to three short sentences"), true);
check("words must modify something sensible", rules.includes("sensibly modifies"), true);
check("and naturalness wins", rules.includes("naturalness comes first"), true);
check("the level no longer caps the sentence count", LEVEL_RULES.A1.includes("per message"), false);

console.log("\nMarking ignores how it is written");
// Flattened: the prompt is wrapped, so a phrase can straddle two lines.
const marker = markerPrompt("Spanish", "A1").toLowerCase().replace(/\s+/g, " ");
check("accents, capitals and punctuation are all out of scope", marker.includes("ignore accents, capital letters and punctuation"), true);
check("and not worth a note either", marker.includes("worth a note"), true);

// A trial answered with two JSON objects, one per sentence, and the round died.
console.log("\nReading the AI's answer");
check("plain JSON", (parseJson('{"a":1}') as any)?.a, 1);
check("in a code fence", (parseJson('```json\n{"a":2}\n```') as any)?.a, 2);
check("with words either side", (parseJson('Here:\n{"a":3}\nhope that helps') as any)?.a, 3);
check("two objects in a row: take the first", (parseJson('{"a":4}\n{"a":5}') as any)?.a, 4);
check("braces inside a string do not confuse it", (parseJson('{"a":"} {"}') as any)?.a, "} {");
check("nothing usable", parseJson("sorry, I cannot"), null);

// One trial silently dropped a word it had been given.
console.log("\nChecking every word was used");
const words = [
  { term: "la música", english: "the music" },
  { term: "hablar", english: "to speak" },
  { term: "te", english: "you" },
];
check("all present, conjugated and agreed", missingWords(words, "te hablamos de la música bonita"), []);
check("one left out", missingWords(words, "te hablamos de la fiesta"), ["la música"]);
check("the article is not part of the word", missingWords([{ term: "la papa/la patata", english: "the potato" }], "comemos papas fritas"), []);
// A trial flagged "ser" as missing from a sentence containing "es".
check("short irregulars are never flagged", missingWords([{ term: "ser", english: "to be" }], "el país es bonito"), []);
check("nor ir, which becomes va", missingWords([{ term: "ir", english: "to go" }], "ella va a casa"), []);
check("but a real omission still shows", missingWords([{ term: "la chaqueta", english: "the jacket" }], "el hospital está cerca"), ["la chaqueta"]);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
