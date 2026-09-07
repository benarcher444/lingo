import { asc, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sessionIdFrom, userForSession } from "./auth.js";
import { db } from "./db/index.js";
import { languages, wordTypes, type Language, type User } from "./db/schema.js";
import type { NavContext } from "./views/layout.js";

export interface AppContext extends NavContext {
  user: User;
}

/**
 * Resolve the signed-in user and their selected language. Returns null when
 * there is no valid session; callers redirect to /login.
 *
 * Language selection comes from `?language=`, falling back to the first
 * language the user owns. The id is always checked against the user's own
 * rows, so a guessed id from another account resolves to null rather than
 * leaking someone else's vocabulary.
 */
export function loadContext(
  request: FastifyRequest,
  active: string,
): AppContext | null {
  const user = userForSession(sessionIdFrom(request));
  if (!user) return null;

  const owned = db
    .select()
    .from(languages)
    .where(eq(languages.userId, user.id))
    .orderBy(asc(languages.name))
    .all();

  const requested = Number(
    (request.query as Record<string, unknown> | undefined)?.["language"] ?? NaN,
  );

  const currentLanguage =
    owned.find((l) => l.id === requested) ?? owned[0] ?? null;

  return { user, languages: owned, currentLanguage, active };
}

/** Redirect helper for pages that need a session. */
export function requireContext(
  request: FastifyRequest,
  reply: FastifyReply,
  active: string,
): AppContext | null {
  const ctx = loadContext(request, active);
  if (!ctx) {
    reply.redirect("/login");
    return null;
  }
  return ctx;
}

/**
 * Read a positive integer from a query string, treating absent, empty and
 * non-numeric values alike as "not given".
 *
 * Written because `Number("")` is `0`, not `NaN`, and `Number.isInteger(0)` is
 * true — so an empty `?type=` from a select whose default option has an empty
 * value read as a real id of 0 and filtered everything away.
 */
export function optionalId(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function typesFor(language: Language | null) {
  if (!language) return [];
  return db
    .select()
    .from(wordTypes)
    .where(eq(wordTypes.languageId, language.id))
    .orderBy(asc(wordTypes.sortOrder), asc(wordTypes.name))
    .all();
}

/** Word types created with a new language — the categories the old app used. */
export const DEFAULT_WORD_TYPES = [
  "nouns",
  "verbs",
  "adjectives",
  "adverbs",
  "phrases",
  "prepositions",
  "conjunctions",
  "other",
];

/** Language name to a text-to-speech locale. Extend as languages are added. */
export const TTS_CODES: Record<string, string> = {
  french: "fr-FR",
  spanish: "es-ES",
  german: "de-DE",
  italian: "it-IT",
  portuguese: "pt-PT",
  dutch: "nl-NL",
  polish: "pl-PL",
  russian: "ru-RU",
  japanese: "ja-JP",
  mandarin: "zh-CN",
  chinese: "zh-CN",
  korean: "ko-KR",
  arabic: "ar-SA",
  turkish: "tr-TR",
  greek: "el-GR",
  swedish: "sv-SE",
  norwegian: "nb-NO",
  danish: "da-DK",
  welsh: "cy-GB",
  irish: "ga-IE",
};

export function guessTtsCode(name: string): string {
  return TTS_CODES[name.trim().toLowerCase()] ?? "en-GB";
}
