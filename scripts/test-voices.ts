/**
 * Which speech voice a language is read in (public/voices.js). Spanish is set
 * to Latin American; where a device has no US Spanish voice it should use
 * another Latin American one before Spain's.
 *
 *   npx tsx scripts/test-voices.ts
 */

type Voice = { lang: string; name: string };

// Imported by path so the compiler does not try to type-check browser code.
const { chooseVoice } = (await import("../public/voices.js" as string)) as {
  chooseVoice: (voices: Voice[], languageCode: string) => Voice | null;
};

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}\n         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const voice = (lang: string): Voice => ({ lang, name: lang });
const pick = (langs: string[], code: string) => chooseVoice(langs.map(voice), code)?.lang ?? null;

console.log("\nLatin American Spanish");
check("Chrome: US Spanish, though Spain's is listed first", pick(["es-ES", "es-US"], "es-US"), "es-US");
check("iPhone: Mexican before Spain's", pick(["es-ES", "es-MX"], "es-US"), "es-MX");
check("the Latin American tag", pick(["es-ES", "es-419"], "es-US"), "es-419");
check("Spain's only when there is nothing else", pick(["en-GB", "es-ES"], "es-US"), "es-ES");
check("Android's underscores", pick(["es_ES", "es_US"], "es-US"), "es_US");

console.log("\nOther languages are unchanged");
check("exact accent first", pick(["fr-CA", "fr-FR"], "fr-FR"), "fr-FR");
check("then the language, in the browser's order", pick(["fr-CA", "fr-BE"], "fr-FR"), "fr-CA");
check("nothing suitable", pick(["en-GB"], "es-US"), null);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
