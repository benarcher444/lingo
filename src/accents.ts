/**
 * Accent input support.
 *
 * Typing é on a UK keyboard means either switching layout or memorising Alt
 * codes. Since building a vocabulary means typing hundreds of them, the app
 * handles it: type the plain letter, then the accent key.
 *
 *   e '   ->  é          a `   ->  à          c ,   ->  ç
 *   e `   ->  è          o ^   ->  ô          n ~   ->  ñ
 *   e ^   ->  ê          i "   ->  ï          o e   ->  œ
 *
 * Only combinations that produce a letter the language actually uses are
 * converted. That matters: in French `qu'est` must stay `qu'est` rather than
 * becoming `qú est`, and it does, because ú is not a French letter.
 */

/** Accent key -> the letters it can modify, and what each becomes. */
const COMPOSITIONS: Record<string, Record<string, string>> = {
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ć", n: "ń", s: "ś", z: "ź" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", w: "ŵ", y: "ŷ" },
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ" },
  ":": { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ" },
  "~": { a: "ã", e: "ẽ", n: "ñ", o: "õ" },
  ",": { c: "ç", s: "ş", t: "ţ" },
  "/": { o: "ø", l: "ł", d: "đ" },
};

/** Ligatures and other letters that are not a base plus an accent. */
const LIGATURES: Record<string, string> = {
  oe: "œ",
  ae: "æ",
  ss: "ß",
};

/**
 * Which letters each language actually uses. A composition only applies if its
 * result appears here, so nothing invents letters the language does not have.
 */
const LANGUAGE_LETTERS: Record<string, string> = {
  fr: "àâæçéèêëîïôœùûüÿ",
  es: "áéíñóúü¿¡",
  de: "äöüß",
  it: "àèéìòóù",
  pt: "áàâãçéêíóôõú",
  nl: "áéíóúëïöü",
  pl: "ąćęłńóśźż",
  sv: "åäö",
  nb: "æøå",
  da: "æøå",
  tr: "çğıöşü",
  cy: "âêîôûŵŷ",
  ga: "áéíóú",
  ro: "ăâîșț",
  cs: "áčďéěíňóřšťúůýž",
  hu: "áéíóöőúüű",
  fi: "äöå",
  is: "áðéíóúýþæö",
  ca: "àçèéíïòóúü",
};

/** The characters shown on the accent bar, most-used first. */
const QUICK_BARS: Record<string, string[]> = {
  // Ordered by how often each appears in real French vocabulary — é dominates.
  fr: ["é", "è", "ê", "à", "ô", "î", "ç", "û", "â", "ù", "ë", "ï", "œ", "’"],
  es: ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"],
  de: ["ä", "ö", "ü", "ß"],
  it: ["à", "è", "é", "ì", "ò", "ù"],
  pt: ["á", "ã", "â", "à", "é", "ê", "í", "ó", "õ", "ô", "ú", "ç"],
  nl: ["é", "ë", "ï", "ö", "ü"],
  pl: ["ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż"],
  sv: ["å", "ä", "ö"],
  nb: ["æ", "ø", "å"],
  da: ["æ", "ø", "å"],
  tr: ["ç", "ğ", "ı", "ö", "ş", "ü"],
  cy: ["â", "ê", "î", "ô", "û", "ŵ", "ŷ"],
  ga: ["á", "é", "í", "ó", "ú"],
  ro: ["ă", "â", "î", "ș", "ț"],
  cs: ["á", "č", "é", "ě", "í", "ř", "š", "ú", "ý", "ž"],
  hu: ["á", "é", "í", "ó", "ö", "ő", "ú", "ü", "ű"],
  fi: ["ä", "ö", "å"],
  ca: ["à", "è", "é", "í", "ò", "ó", "ú", "ç", "ï", "ü"],
};

/** "fr-FR" -> "fr". */
function baseCode(languageCode: string): string {
  return (languageCode || "").split(/[-_]/)[0]!.toLowerCase();
}

export interface AccentConfig {
  /** Typed sequence -> replacement, e.g. { "e'": "é" }. */
  compose: Record<string, string>;
  /** Characters offered on the clickable bar. */
  bar: string[];
}

/**
 * Build the composition table for one language. Precomputed on the server so
 * the browser only does a map lookup.
 */
export function accentConfigFor(languageCode: string): AccentConfig {
  const code = baseCode(languageCode);
  const letters = LANGUAGE_LETTERS[code] ?? "";
  const compose: Record<string, string> = {};

  if (letters) {
    for (const [accentKey, table] of Object.entries(COMPOSITIONS)) {
      for (const [letter, accented] of Object.entries(table)) {
        // Skip anything this language does not use — this is what keeps
        // French "qu'est" intact while still allowing Spanish "tú".
        if (!letters.includes(accented)) continue;

        compose[`${letter}${accentKey}`] = accented;
        compose[`${letter.toUpperCase()}${accentKey}`] = accented.toUpperCase();

        // Pressing the accent key again undoes it: e ' gives é, e ' ' gives e'.
        // Written as a reverse entry so the browser needs no special case —
        // "é" plus "'" simply maps back to the literal pair.
        compose[`${accented}${accentKey}`] = `${letter}${accentKey}`;
        compose[`${accented.toUpperCase()}${accentKey}`] =
          `${letter.toUpperCase()}${accentKey}`;
      }
    }

    for (const [sequence, ligature] of Object.entries(LIGATURES)) {
      if (!letters.includes(ligature)) continue;
      compose[sequence] = ligature;
      compose[sequence.toUpperCase()] = ligature.toUpperCase();
    }
  }

  return { compose, bar: QUICK_BARS[code] ?? [] };
}

/** True when the language has any accented characters worth helping with. */
export function hasAccents(languageCode: string): boolean {
  return (QUICK_BARS[baseCode(languageCode)] ?? []).length > 0;
}
