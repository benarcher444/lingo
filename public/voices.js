/**
 * Which speech voice to read a language in, shared by practice and chat.
 *
 * The exact accent first, then the nearest one the device has, then any voice
 * of the language — each in the order the browser lists them. Deliberately not
 * reordered to prefer local voices: that would silently swap the voice the
 * learner hears.
 */

/** Accents to try, in order, when the exact one is not installed. */
const NEAREST = {
  // Latin American Spanish. Chrome's Google voice is US Spanish and iOS ships
  // Mexican; Spain's accent is only the last resort.
  "es-us": ["es-419", "es-mx", "es-co", "es-ar", "es-cl", "es-pe", "es-ve"],
};

const tag = (voice) => (voice.lang || "").toLowerCase().replace("_", "-");

export function chooseVoice(voices, languageCode) {
  const lang = (languageCode || "en-GB").toLowerCase();

  const exact = voices.find((v) => tag(v) === lang);
  if (exact) return exact;

  for (const near of NEAREST[lang] ?? []) {
    const voice = voices.find((v) => tag(v) === near);
    if (voice) return voice;
  }

  return voices.find((v) => tag(v).startsWith(lang.slice(0, 2))) ?? null;
}
