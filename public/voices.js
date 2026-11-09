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

/**
 * The plain word to say: without parenthetical notes, or it reads "because
 * open bracket p q", and only the first alternative before a slash, or "to
 * do/make" is read as "to do slash make".
 */
export function spokenForm(text) {
  const spoken = String(text)
    .replace(/\([^)]*\)/g, " ")
    .split("/")[0]
    .replace(/\s+/g, " ")
    .trim();
  return spoken || String(text);
}

/** For naming the missing voice in a sentence rather than as a code. */
const LANGUAGE_NAMES = {
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  en: "English",
};

const languageName = (code) =>
  LANGUAGE_NAMES[String(code || "").slice(0, 2).toLowerCase()] ?? String(code || "this language");

/**
 * Why nothing was heard, or null if there is nothing wrong.
 *
 * **Browser speech fails silently**, and that is the whole problem: a browser
 * with no engine, a device with no voice data, and a language the device has
 * no voice for all produce exactly the same nothing. Without this, the only
 * report possible is "the sound does not work", which names none of them.
 */
export function speechTrouble(languageCode) {
  const synth = window.speechSynthesis;
  if (!synth) return "This browser has no speech engine.";

  const voices = synth.getVoices();
  if (!voices.length) return "This device has no speech voices installed.";
  if (!chooseVoice(voices, languageCode)) {
    return `This device has no ${languageName(languageCode)} voice installed.`;
  }
  return null;
}

/** Said once per page, however many times speech is attempted. */
let toldOnce = false;

/** Puts the reason on the page, where silence otherwise explains nothing. */
export function showSpeechTrouble(message) {
  if (toldOnce || !message || typeof document === "undefined") return;
  toldOnce = true;

  const note = document.createElement("div");
  note.className = "alert alert-info speech-trouble";
  note.setAttribute("role", "status");

  const lead = document.createElement("strong");
  lead.textContent = "No sound: ";
  const why = document.createElement("span");
  why.textContent = message;
  const how = document.createElement("div");
  how.className = "hint";
  how.textContent =
    "Android: Settings \u203a Accessibility \u203a Text-to-speech output \u2014 open the engine's settings and install the language. iPhone: Settings \u203a Accessibility \u203a Spoken Content \u203a Voices.";

  note.append(lead, why, how);

  const host =
    document.querySelector(".container .stack") ?? document.querySelector("main") ?? document.body;
  host.prepend(note);
}

/**
 * Checks before speaking and says on the page if something is wrong.
 *
 * Deliberately **advisory**: it never stops the attempt. Voices arrive
 * asynchronously and an empty list early on is normal, so an empty list is
 * given one more chance before the device gets the blame.
 */
export function checkSpeech(languageCode) {
  const synth = window.speechSynthesis;
  if (!synth) return showSpeechTrouble("This browser has no speech engine.");

  if (!synth.getVoices().length) {
    window.setTimeout(() => showSpeechTrouble(speechTrouble(languageCode)), 1500);
    return;
  }
  showSpeechTrouble(speechTrouble(languageCode));
}

/**
 * Reports an utterance that failed, ignoring the two "errors" that are us.
 * Cancelling to speak something else raises one of those every time.
 */
export function watchForSpeechError(utterance) {
  utterance.onerror = (event) => {
    const reason = event?.error ?? "unknown";
    if (reason === "canceled" || reason === "interrupted") return;
    showSpeechTrouble(`the speech engine stopped with "${reason}".`);
  };
  return utterance;
}

/**
 * Say a word once in the language's voice, for pages with no speech set-up of
 * their own. Call it from a tap or click: browsers hold back speech a page
 * starts by itself.
 */
export function speak(text, languageCode) {
  const synth = window.speechSynthesis;
  if (!synth) return showSpeechTrouble("This browser has no speech engine.");

  checkSpeech(languageCode);

  // Only cut off something actually playing: cancelling an idle engine can
  // delay what is spoken straight after it.
  if (synth.speaking || synth.pending) synth.cancel();

  // Chrome can leave its queue paused after a cancel and then accept speak()
  // without ever saying anything. resume() is a no-op unless that happened.
  synth.resume();

  const utterance = new SpeechSynthesisUtterance(spokenForm(text));
  utterance.lang = languageCode || "en-GB";
  const voice = chooseVoice(synth.getVoices(), languageCode);
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9;
  synth.speak(watchForSpeechError(utterance));
}
