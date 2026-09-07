/**
 * Checks the accent composition table, particularly that it never converts a
 * letter the language does not use.
 *
 *   npx tsx scripts/test-accents.ts
 */

import { accentConfigFor, hasAccents } from "../src/accents.js";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}\n         got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

/** Replays what the browser does: scan for a letter followed by an accent key. */
function type(text: string, languageCode: string): string {
  const { compose } = accentConfigFor(languageCode);
  let out = "";

  for (const character of text) {
    const previous = out.at(-1);
    const replacement = previous ? compose[previous + character] : undefined;

    if (replacement) {
      out = out.slice(0, -1) + replacement;
    } else {
      out += character;
    }
  }

  return out;
}

console.log("\nFrench");
check("café, e then apostrophe", type("cafe'", "fr-FR"), "café");
check("été", type("e'te'", "fr-FR"), "été");
check("après, e then backtick", type("apre`s", "fr-FR"), "après");
check("être", type("e^tre", "fr-FR"), "être");
check("à", type("a`", "fr-FR"), "à");
check("ç", type("c,a", "fr-FR"), "ça");
check("ô", type("to^t", "fr-FR"), "tôt");
check("î", type("i^le", "fr-FR"), "île");
check("ï", type('i"', "fr-FR"), "ï");
check("œ ligature", type("coeur", "fr-FR"), "cœur");

console.log("\nPressing the accent key twice keeps it literal");
check("e'' stays e'", type("e''", "fr-FR"), "e'");
check("a`` stays a`", type("a``", "fr-FR"), "a`");
check("cafe'' stays cafe'", type("cafe''", "fr-FR"), "cafe'");

console.log("\nFrench leaves apostrophes alone");
// u' would be ú, which is not French — so the apostrophe must survive.
check("qu'est stays intact", type("qu'est", "fr-FR"), "qu'est");
check("jusqu'à", type("jusqu'a`", "fr-FR"), "jusqu'à");
check("l'eau", type("l'eau", "fr-FR"), "l'eau");
check("n'a", type("n'a", "fr-FR"), "n'a");
check("d'accord", type("d'accord", "fr-FR"), "d'accord");

console.log("\nSpanish");
check("á", type("a'", "es-ES"), "á");
check("ñ", type("man~ana", "es-ES"), "mañana");
check("ú allowed in Spanish", type("tu'", "es-ES"), "tú");
check("¿ is on the bar, not composed", accentConfigFor("es-ES").bar.includes("¿"), true);

console.log("\nOther languages");
check("German ä", type('a"', "de-DE"), "ä");
check("German ß", type("stross", "de-DE"), "stroß");
check("German does not get é", type("e'", "de-DE"), "e'");
check("Portuguese ã", type("na~o", "pt-PT"), "não");
check("Polish ł", type("l/", "pl-PL"), "ł");
check("Turkish ş", type("s,", "tr-TR"), "ş");

console.log("\nCapitals");
check("É", type("E'", "fr-FR"), "É");
check("Ç", type("C,", "fr-FR"), "Ç");

console.log("\nLanguages without accents are left alone");
check("English has no bar", hasAccents("en-GB"), false);
check("English composes nothing", type("e'", "en-GB"), "e'");
check("unknown code is safe", type("e'", "xx-XX"), "e'");

console.log("\nThe bar leads with the most-used character");
check("French bar starts with é", accentConfigFor("fr-FR").bar[0], "é");
check("Spanish bar starts with á", accentConfigFor("es-ES").bar[0], "á");

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
