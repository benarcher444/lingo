import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Everything hangs off a user, so multi-user is structural rather than
 * retrofitted. Languages are rows, not folders, so adding one is an insert.
 *
 * Schema is written against Drizzle's SQLite driver; moving to Postgres for a
 * hosted deployment is a driver swap rather than a rewrite.
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Wrong passwords since the last good sign-in. Five locks the account. */
  failedLogins: integer("failed_logins").notNull().default(0),
  /** Set when the account locks; cleared by unlock-account.ts or set-password.ts. */
  lockedAt: text("locked_at"),
  /**
   * "auto" follows the device's light/dark setting; "light" and "dark" force
   * it. Kept on the account rather than in the browser, so one choice holds on
   * every device.
   */
  theme: text("theme", { enum: ["auto", "light", "dark"] }).notNull().default("auto"),
  createdAt: text("created_at").notNull().default(now),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId),
  }),
);

export const languages = sqliteTable(
  "languages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Display name, e.g. "French". */
    name: text("name").notNull(),
    /** BCP-47-ish code used for text-to-speech, e.g. "fr". */
    code: text("code").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => ({
    userNameIdx: uniqueIndex("languages_user_name_idx").on(table.userId, table.name),
  }),
);

export const wordTypes = sqliteTable(
  "word_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    languageId: integer("language_id")
      .notNull()
      .references(() => languages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => ({
    languageNameIdx: uniqueIndex("word_types_language_name_idx").on(
      table.languageId,
      table.name,
    ),
  }),
);

export const words = sqliteTable(
  "words",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wordTypeId: integer("word_type_id")
      .notNull()
      .references(() => wordTypes.id, { onDelete: "cascade" }),
    /** The target-language term, usually with its article ("la femme"). */
    term: text("term").notNull(),
    english: text("english").notNull(),
    /** Opt-in flags per mode. The original filtered on a column that never existed. */
    writtenEnabled: integer("written_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    audioEnabled: integer("audio_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => ({
    typeIdx: index("words_type_idx").on(table.wordTypeId),
    typeTermIdx: uniqueIndex("words_type_term_idx").on(table.wordTypeId, table.term),
  }),
);

/**
 * One row per (word, mode, direction). Score is NOT stored — it depends on
 * today's date and is recomputed on read in src/algorithm.ts.
 *
 * direction is "to_english" / "from_english" for written mode, "listen" for audio.
 */
export const progress = sqliteTable(
  "progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wordId: integer("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    direction: text("direction").notNull(),
    tested: integer("tested").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    /** Consecutive correct answers, clamped 0..3. Reset to 0 on a miss. */
    streak: integer("streak").notNull().default(0),
    /** YYYY-MM-DD, or null if never tested. */
    lastTested: text("last_tested"),
  },
  (table) => ({
    wordModeDirectionIdx: uniqueIndex("progress_word_mode_direction_idx").on(
      table.wordId,
      table.mode,
      table.direction,
    ),
    wordIdx: index("progress_word_idx").on(table.wordId),
  }),
);

/**
 * One row per answer. The original kept only aggregates, so retuning the score
 * formula meant losing history; with this the whole record can be replayed.
 */
export const attempts = sqliteTable(
  "attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    wordId: integer("word_id")
      .notNull()
      .references(() => words.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    direction: text("direction").notNull(),
    correct: integer("correct", { mode: "boolean" }).notNull(),
    /** True when the learner overrode a wrong answer to correct. */
    overridden: integer("overridden", { mode: "boolean" }).notNull().default(false),
    givenAnswer: text("given_answer"),
    /**
     * Which practice session this answer belonged to. Lets "words tested today"
     * be counted the way a daily target is counted — three sessions of 30, 30
     * and 40 is 100, whether or not the same word appeared twice. Counting
     * distinct words instead would report a smaller, different thing.
     *
     * Null on rows recorded before sessions were tracked.
     */
    sessionId: text("session_id"),
    answeredAt: text("answered_at").notNull().default(now),
  },
  (table) => ({
    wordIdx: index("attempts_word_idx").on(table.wordId),
    answeredAtIdx: index("attempts_answered_at_idx").on(table.answeredAt),
    sessionIdx: index("attempts_session_idx").on(table.sessionId),
  }),
);

/**
 * Append-only long-format history, the shape the original used and the reason
 * its dashboard worked. wordTypeId null means "all word types for this language".
 */
export const statSnapshots = sqliteTable(
  "stat_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    languageId: integer("language_id")
      .notNull()
      .references(() => languages.id, { onDelete: "cascade" }),
    wordTypeId: integer("word_type_id").references(() => wordTypes.id, {
      onDelete: "cascade",
    }),
    mode: text("mode").notNull(),
    takenAt: text("taken_at").notNull().default(now),
    measure: text("measure").notNull(),
    value: real("value").notNull(),
  },
  (table) => ({
    languageIdx: index("stat_snapshots_language_idx").on(table.languageId),
    takenAtIdx: index("stat_snapshots_taken_at_idx").on(table.takenAt),
  }),
);

/** Free-form per-user settings (learner level, AI key presence, thresholds). */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => ({
    userKeyIdx: uniqueIndex("settings_user_key_idx").on(table.userId, table.key),
  }),
);

export type User = typeof users.$inferSelect;
export type Language = typeof languages.$inferSelect;
export type WordType = typeof wordTypes.$inferSelect;
export type Word = typeof words.$inferSelect;
export type Progress = typeof progress.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type StatSnapshot = typeof statSnapshots.$inferSelect;
