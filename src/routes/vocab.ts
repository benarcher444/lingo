import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";

import { accentConfigFor } from "../accents.js";
import type { Mode } from "../algorithm.js";
import { loadWordDetail } from "../word-detail.js";
import { wordDetailPanel } from "../views/word-detail-view.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  DEFAULT_WORD_TYPES,
  guessTtsCode,
  optionalId,
  rememberLanguage,
  requireContext,
  typesFor,
} from "../context.js";
import { db } from "../db/index.js";
import { languages, wordTypes, words } from "../db/schema.js";
import { loadScoredWords, summarise, summariseByType } from "../stats.js";
import {
  NO_AUTOFILL,
  alert,
  pageHead,
  progressBanner,
  scorePill,
} from "../views/components.js";
import { esc, icons, layout } from "../views/layout.js";

const wordInput = z.object({
  term: z.string().trim().min(1, "Enter the word or phrase."),
  english: z.string().trim().min(1, "Enter the English meaning."),
  wordTypeId: z.coerce.number().int().positive(),
  writtenEnabled: z.coerce.boolean().optional().default(true),
  audioEnabled: z.coerce.boolean().optional().default(true),
  notes: z.string().trim().max(500).optional(),
});

/**
 * The filters currently applied to the word list. Carried through Edit, Cancel
 * and the post-save redirect — without it, editing a word you found by
 * searching dumps you back on the unfiltered list, which reads as the page
 * refreshing and losing your place.
 */
interface ListFilters {
  type?: number | null;
  q?: string;
  sort?: SortKey;
  /** Which practice mode the banner and status column report on. */
  mode?: Mode;
}

/** Sort orders offered on the word list. */
const SORTS = {
  added_desc: "Newest first",
  added_asc: "Oldest first",
  score_desc: "Score: high to low",
  score_asc: "Score: low to high",
  alpha: "A–Z",
} as const;

type SortKey = keyof typeof SORTS;

/**
 * Reads the list filters from a query string, or from the fields the edit form
 * echoes back. The page, the save and the row fragments must agree on them.
 */
function filtersFrom(source: Record<string, unknown>): {
  type: number | null;
  q: string;
  sort: SortKey;
  mode: Mode;
} {
  const text = (key: string) => (typeof source[key] === "string" ? (source[key] as string) : "");
  const sort = text("sort");
  return {
    // "All types" submits an empty value, which must read as absent, not 0.
    type: optionalId(text("type")),
    q: text("q").trim(),
    sort: Object.hasOwn(SORTS, sort) ? (sort as SortKey) : "added_desc",
    mode: text("mode") === "audio" ? "audio" : "written",
  };
}

function vocabUrl(
  languageId: number | undefined,
  filters: ListFilters,
  extra: Record<string, string | number> = {},
): string {
  const params = new URLSearchParams();
  if (languageId) params.set("language", String(languageId));
  if (filters.type) params.set("type", String(filters.type));
  if (filters.q) params.set("q", filters.q);
  if (filters.sort && filters.sort !== "added_desc") params.set("sort", filters.sort);
  if (filters.mode === "audio") params.set("mode", "audio");
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return `/vocab?${params.toString()}`;
}

/** Confirm a word type belongs to the signed-in user before writing to it. */
function ownsWordType(userId: number, wordTypeId: number): boolean {
  const row = db
    .select({ id: wordTypes.id })
    .from(wordTypes)
    .innerJoin(languages, eq(languages.id, wordTypes.languageId))
    .where(and(eq(wordTypes.id, wordTypeId), eq(languages.userId, userId)))
    .get();
  return Boolean(row);
}

function ownsWord(userId: number, wordId: number): boolean {
  const row = db
    .select({ id: words.id })
    .from(words)
    .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
    .innerJoin(languages, eq(languages.id, wordTypes.languageId))
    .where(and(eq(words.id, wordId), eq(languages.userId, userId)))
    .get();
  return Boolean(row);
}

/** What the word list shows of each word — shared by the page and its row fragments. */
const listColumns = {
  id: words.id,
  term: words.term,
  english: words.english,
  wordTypeId: words.wordTypeId,
  wordTypeName: wordTypes.name,
  writtenEnabled: words.writtenEnabled,
  audioEnabled: words.audioEnabled,
  notes: words.notes,
  createdAt: words.createdAt,
};

/**
 * Spelling as the duplicate check compares it. Case, spacing and apostrophe
 * style are ignored. Accents are kept, because té (tea) and te (you) are
 * different words.
 */
function spellingKey(term: string): string {
  return term
    .normalize("NFC")
    .replace(/[’‘`]/g, "'")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * A word already in the category's language spelled the same way, in any
 * category. `exceptId` skips the word being edited, so saving it unchanged is
 * never a clash.
 */
function findSameSpelling(wordTypeId: number, term: string, exceptId?: number) {
  const language = db
    .select({ languageId: wordTypes.languageId })
    .from(wordTypes)
    .where(eq(wordTypes.id, wordTypeId))
    .get();
  if (!language) return undefined;

  const key = spellingKey(term);
  return db
    .select({
      id: words.id,
      term: words.term,
      english: words.english,
      wordTypeName: wordTypes.name,
    })
    .from(words)
    .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
    .where(eq(wordTypes.languageId, language.languageId))
    .all()
    .find((w) => w.id !== exceptId && spellingKey(w.term) === key);
}

function duplicateMessage(existing: { term: string; english: string; wordTypeName: string }): string {
  return `“${existing.term}” is already in your list, as “${existing.english}” (${existing.wordTypeName}). Edit that entry instead — a second meaning can go in with a slash.`;
}

function loadListRow(languageId: number, wordId: number) {
  return db
    .select(listColumns)
    .from(words)
    .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
    .where(and(eq(words.id, wordId), eq(wordTypes.languageId, languageId)))
    .get();
}

export async function vocabRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------
     Languages
     --------------------------------------------------------------- */

  app.post("/languages", async (request, reply) => {
    const ctx = requireContext(request, reply, "vocab");
    if (!ctx) return;

    const parsed = z
      .object({ name: z.string().trim().min(1).max(40) })
      .safeParse(request.body);

    if (!parsed.success) return reply.redirect("/vocab?error=name");

    const name = parsed.data.name;

    const existing = db
      .select()
      .from(languages)
      .where(and(eq(languages.userId, ctx.user.id), eq(languages.name, name)))
      .get();

    if (existing) {
      rememberLanguage(request, reply, existing.id);
      return reply.redirect(`/vocab?language=${existing.id}`);
    }

    const created = db
      .insert(languages)
      .values({ userId: ctx.user.id, name, code: guessTtsCode(name) })
      .returning()
      .get();

    // Seed the default categories so the vocabulary page is usable immediately.
    db.insert(wordTypes)
      .values(
        DEFAULT_WORD_TYPES.map((typeName, index) => ({
          languageId: created.id,
          name: typeName,
          sortOrder: index,
        })),
      )
      .run();

    rememberLanguage(request, reply, created.id);
    return reply.redirect(`/vocab?language=${created.id}&added=language`);
  });

  /* ---------------------------------------------------------------
     Word types
     --------------------------------------------------------------- */

  app.post("/word-types", async (request, reply) => {
    const ctx = requireContext(request, reply, "vocab");
    if (!ctx) return;

    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40),
        languageId: z.coerce.number().int().positive(),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.redirect("/vocab?error=type");

    const owned = ctx.languages.some((l) => l.id === parsed.data.languageId);
    if (!owned) return reply.redirect("/vocab");

    const maxOrder = db
      .select({ value: sql<number>`coalesce(max(${wordTypes.sortOrder}), 0)` })
      .from(wordTypes)
      .where(eq(wordTypes.languageId, parsed.data.languageId))
      .get();

    db.insert(wordTypes)
      .values({
        languageId: parsed.data.languageId,
        name: parsed.data.name.toLowerCase(),
        sortOrder: (maxOrder?.value ?? 0) + 1,
      })
      .onConflictDoNothing()
      .run();

    return reply.redirect(`/vocab?language=${parsed.data.languageId}&added=type`);
  });

  /* ---------------------------------------------------------------
     Words
     --------------------------------------------------------------- */

  app.post("/words", async (request, reply) => {
    const ctx = requireContext(request, reply, "vocab");
    if (!ctx) return;

    const body = request.body as Record<string, unknown>;
    const parsed = wordInput.safeParse({
      ...body,
      writtenEnabled: body["writtenEnabled"] !== undefined,
      audioEnabled: body["audioEnabled"] !== undefined,
    });

    const languageId = ctx.currentLanguage?.id;

    if (!parsed.success || !ownsWordType(ctx.user.id, parsed.data.wordTypeId)) {
      return reply.redirect(`/vocab?language=${languageId}&error=word`);
    }

    const duplicate = findSameSpelling(parsed.data.wordTypeId, parsed.data.term);
    if (duplicate) {
      return reply.redirect(
        `/vocab?language=${languageId}&type=${parsed.data.wordTypeId}&error=duplicate&dup=${encodeURIComponent(duplicate.term)}`,
      );
    }

    db.insert(words)
      .values({
        wordTypeId: parsed.data.wordTypeId,
        term: parsed.data.term,
        english: parsed.data.english,
        writtenEnabled: parsed.data.writtenEnabled,
        audioEnabled: parsed.data.audioEnabled,
        notes: parsed.data.notes || null,
      })
      .onConflictDoNothing()
      .run();

    // Keep the chosen type selected so a run of words can be typed in quickly.
    return reply.redirect(
      `/vocab?language=${languageId}&type=${parsed.data.wordTypeId}&added=word`,
    );
  });

  /**
   * JSON sibling of POST /words, for the keyboard-driven add flow. Returns the
   * created row so the page can prepend it without a reload — the reload was
   * what made adding a run of words slow.
   */
  app.post("/api/words", async (request, reply) => {
    const ctx = requireContext(request, reply, "vocab");
    if (!ctx) return;

    const parsed = wordInput.safeParse(request.body);

    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? "Check the fields." });
    }

    if (!ownsWordType(ctx.user.id, parsed.data.wordTypeId)) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const duplicate = findSameSpelling(parsed.data.wordTypeId, parsed.data.term);
    if (duplicate) {
      return reply.code(409).send({ error: duplicateMessage(duplicate) });
    }

    const created = db
      .insert(words)
      .values({
        wordTypeId: parsed.data.wordTypeId,
        term: parsed.data.term,
        english: parsed.data.english,
        writtenEnabled: parsed.data.writtenEnabled,
        audioEnabled: parsed.data.audioEnabled,
        notes: parsed.data.notes || null,
      })
      .onConflictDoNothing()
      .returning()
      .get();

    // onConflictDoNothing returns nothing when the word is already in that
    // category — say so rather than silently swallowing the entry.
    if (!created) {
      return reply.code(409).send({ error: `"${parsed.data.term}" is already in this category.` });
    }

    const type = db
      .select({ name: wordTypes.name })
      .from(wordTypes)
      .where(eq(wordTypes.id, created.wordTypeId))
      .get();

    return reply.send({
      word: {
        id: created.id,
        term: created.term,
        english: created.english,
        wordTypeName: type?.name ?? "",
        writtenEnabled: created.writtenEnabled,
        audioEnabled: created.audioEnabled,
      },
    });
  });

  app.post("/words/:id", async (request, reply) => {
    const ctx = requireContext(request, reply, "vocab");
    if (!ctx) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || !ownsWord(ctx.user.id, id)) {
      return reply.redirect("/vocab");
    }

    const body = request.body as Record<string, unknown>;

    // The edit form echoes the active filters back so the redirect can return
    // you to the same filtered view rather than the whole list.
    const filters = filtersFrom({
      type: body["_type"],
      q: body["_q"],
      sort: body["_sort"],
      mode: body["_mode"],
    });

    // public/vocab.js edits in place and wants the updated row back, not a page.
    const inPlace = request.headers["x-requested-with"] === "fetch";

    if (body["_action"] === "delete") {
      db.delete(words).where(eq(words.id, id)).run();
      if (inPlace) return reply.send({ ok: true, deleted: true });
      return reply.redirect(
        vocabUrl(ctx.currentLanguage?.id, filters, { deleted: 1 }),
      );
    }

    const parsed = wordInput.safeParse({
      ...body,
      writtenEnabled: body["writtenEnabled"] !== undefined,
      audioEnabled: body["audioEnabled"] !== undefined,
    });

    if (!parsed.success || !ownsWordType(ctx.user.id, parsed.data.wordTypeId)) {
      if (inPlace) {
        return reply
          .code(400)
          .send({ error: "That word could not be saved — check the fields and try again." });
      }
      return reply.redirect(vocabUrl(ctx.currentLanguage?.id, filters, { error: "word" }));
    }

    // Renaming a word onto another's spelling would make a duplicate just the same.
    const duplicate = findSameSpelling(parsed.data.wordTypeId, parsed.data.term, id);
    if (duplicate) {
      if (inPlace) return reply.code(409).send({ error: duplicateMessage(duplicate) });
      return reply.redirect(
        vocabUrl(ctx.currentLanguage?.id, filters, { error: "duplicate", dup: duplicate.term }),
      );
    }

    db.update(words)
      .set({
        term: parsed.data.term,
        english: parsed.data.english,
        wordTypeId: parsed.data.wordTypeId,
        writtenEnabled: parsed.data.writtenEnabled,
        audioEnabled: parsed.data.audioEnabled,
        notes: parsed.data.notes || null,
      })
      .where(eq(words.id, id))
      .run();

    if (inPlace) {
      const language = ctx.currentLanguage;
      const row = language ? loadListRow(language.id, id) : undefined;
      // Moved out of the language on show — let the page reload rather than guess.
      if (!language || !row) return reply.send({ ok: true, reload: true });

      const score =
        loadScoredWords(language.id, filters.mode).find((s) => s.wordId === id)?.score ?? null;
      return reply.send({ ok: true, html: displayRow(row, score, language.id, filters) });
    }

    // Without JavaScript: back to the same row, not the top of the page.
    return reply.redirect(
      `${vocabUrl(ctx.currentLanguage?.id, filters, { saved: 1 })}#word-${id}`,
    );
  });

  /**
   * One word's edit row, for editing in place. As a full page load, every Edit
   * threw the list back to the top and reset the add form, which made editing a
   * run of words a chore. The page still works without this.
   */
  app.get("/vocab/words/:id/edit-row", async (request, reply) => {
    const ctx = requireContext(request, reply, "vocab");
    if (!ctx) return;

    const language = ctx.currentLanguage;
    const id = Number((request.params as { id: string }).id);
    const row = language && Number.isInteger(id) ? loadListRow(language.id, id) : undefined;
    if (!language || !row) return reply.code(404).send("");

    const filters = filtersFrom(request.query as Record<string, unknown>);
    return reply
      .type("text/html")
      .send(editRow(row, typesFor(language), language.id, filters));
  });

  /* ---------------------------------------------------------------
     The page
     --------------------------------------------------------------- */

  app.get("/vocab", async (request, reply) => {
    const ctx = requireContext(request, reply, "vocab");
    if (!ctx) return;

    const query = request.query as Record<string, string | undefined>;

    if (!ctx.currentLanguage) {
      return reply.type("text/html").send(
        layout(ctx, {
          title: "Vocabulary",
          body:
            pageHead({
              title: "Vocabulary",
              sub: "Add a language to start building your word list.",
            }) + firstLanguageCard(),
        }),
      );
    }

    const language = ctx.currentLanguage;
    const types = typesFor(language);
    // Written or listening — the banner and the status column both follow it,
    // as the progress page does.
    /** Carried through Edit, Cancel and the post-save redirect. */
    const listFilters = filtersFrom(query);
    const { type: selectedType, q: search, sort, mode } = listFilters;

    const scored = loadScoredWords(language.id, mode);
    const summary = summarise(scored, mode);
    const typeSummaries = summariseByType(scored, mode);

    const editId = optionalId(query["edit"]);
    const detailId = optionalId(query["word"]);

    const scoreByWord = new Map(scored.map((s) => [s.wordId, s.score]));

    const conditions = [eq(wordTypes.languageId, language.id)];
    if (selectedType !== null) {
      conditions.push(eq(words.wordTypeId, selectedType));
    }
    if (search) {
      const pattern = `%${search}%`;
      const match = or(like(words.term, pattern), like(words.english, pattern));
      if (match) conditions.push(match);
    }

    const rows = db
      .select(listColumns)
      .from(words)
      .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
      .where(and(...conditions))
      // Score is derived rather than stored, so it cannot be an ORDER BY.
      // Sorting happens below, in memory, over the filtered set.
      .orderBy(desc(words.createdAt), asc(words.term))
      .all();

    // Words switched off for this mode have no score; they sink to the bottom
    // in either direction rather than posing as zero.
    const scoreOr = (id: number, missing: number) => scoreByWord.get(id) ?? missing;

    switch (sort) {
      case "added_asc":
        rows.reverse();
        break;
      case "score_desc":
        rows.sort(
          (a, b) => scoreOr(b.id, -1e9) - scoreOr(a.id, -1e9) || a.term.localeCompare(b.term),
        );
        break;
      case "score_asc":
        rows.sort(
          (a, b) => scoreOr(a.id, 1e9) - scoreOr(b.id, 1e9) || a.term.localeCompare(b.term),
        );
        break;
      case "alpha":
        rows.sort((a, b) => a.term.localeCompare(b.term));
        break;
      default:
        break; // added_desc — already newest first from the query
    }

    const shown = rows.slice(0, 300);

    // Clicking a word opens its full record in place of the add form.
    const detail = detailId ? loadWordDetail(ctx.user.id, detailId) : null;

    const flash = flashMessage(query);

    const body = `
      ${pageHead({
        title: "Vocabulary",
        sub: `Add and edit the words you are learning. The breakdown below shows where your ${esc(language.name)} is thin.`,
        actions: `
          <a class="btn${mode === "written" ? " btn-primary" : ""}"
             href="${esc(vocabUrl(language.id, { ...listFilters, mode: "written" }))}">Written</a>
          <a class="btn${mode === "audio" ? " btn-primary" : ""}"
             href="${esc(vocabUrl(language.id, { ...listFilters, mode: "audio" }))}">Listening</a>
          <a class="btn" href="/progress?language=${language.id}${mode === "audio" ? "&mode=audio" : ""}">${icons.chart}View progress</a>`,
      })}

      <div class="stack">
        ${progressBanner({
          summary,
          types: typeSummaries,
          languageName: language.name,
          mode,
          linkBase: vocabUrl(language.id, { mode }),
        })}

        ${flash}

        ${
          detail
            ? wordDetailPanel(detail, vocabUrl(language.id, listFilters))
            : // Not when landing back on a row: autofocus would scroll up to this form.
              addWordCard(language.id, types, selectedType, editId === null && !query["saved"], language.code)
        }

        <div class="card">
          <div class="card-head list-head">
            <div>
              <h2>Your words</h2>
              <div class="sub">${shown.length} of ${rows.length}${rows.length > 300 ? " (first 300)" : ""}${
                selectedType !== null
                  ? ` · ${esc(types.find((t) => t.id === selectedType)?.name ?? "")}`
                  : ""
              }</div>
            </div>
          </div>

          <!-- Its own full-width bar rather than crammed into the card header,
               where three controls were squeezed into a narrow column and
               stacked one per line. -->
          <form class="list-toolbar" method="get" action="/vocab" autocomplete="off">
            <input type="hidden" name="language" value="${language.id}">
            ${mode === "audio" ? `<input type="hidden" name="mode" value="audio">` : ""}

            <label class="toolbar-field">
              <span>Sort</span>
              <select class="select" name="sort" onchange="this.form.submit()">
                ${Object.entries(SORTS)
                  .map(
                    ([key, label]) =>
                      `<option value="${key}"${key === sort ? " selected" : ""}>${esc(label)}</option>`,
                  )
                  .join("")}
              </select>
            </label>

            <label class="toolbar-field">
              <span>Category</span>
              <select class="select" name="type" onchange="this.form.submit()">
                <option value="">All types</option>
                ${types
                  .map(
                    (t) =>
                      `<option value="${t.id}"${t.id === selectedType ? " selected" : ""}>${esc(t.name)}</option>`,
                  )
                  .join("")}
              </select>
            </label>

            <label class="toolbar-field toolbar-search">
              <span>Search</span>
              <input class="input" type="search" name="q" ${NO_AUTOFILL}
                     placeholder="Word or meaning…" value="${esc(search)}">
            </label>

            <button class="btn" type="submit">Search</button>
            ${
              search || selectedType !== null || sort !== "added_desc"
                ? `<a class="btn btn-ghost btn-sm" href="${esc(vocabUrl(language.id, { mode }))}">Clear</a>`
                : ""
            }
          </form>
          ${
            shown.length === 0
              ? `<div class="empty">
                   <div class="empty-icon">${icons.book}</div>
                   <h2>${search || selectedType !== null ? "Nothing matches" : "No words yet"}</h2>
                   <p>${
                     search || selectedType !== null
                       ? "Try a different search or category."
                       : "Add your first word using the form above and it will appear here."
                   }</p>
                 </div>`
              : `<div class="table-wrap"><table class="data">
                  <thead><tr>
                    <th>Word</th><th>English</th><th class="col-type">Type</th><th><span class="col-mode-label">${mode === "audio" ? "Listening" : "Written"} </span>status</th>
                    <th class="col-modes">Modes</th><th style="width:1%"></th>
                  </tr></thead>
                  <tbody>
                    ${shown
                      .map((row) =>
                        row.id === editId
                          ? editRow(row, types, language.id, listFilters)
                          : displayRow(row, scoreByWord.get(row.id) ?? null, language.id, listFilters),
                      )
                      .join("\n")}
                  </tbody>
                </table></div>`
          }
        </div>

        ${manageTypesCard(language.id, types)}
      </div>`;

    return reply.type("text/html").send(
      layout(ctx, {
        title: "Vocabulary",
        body,
        clientData: { name: "__accents", value: accentConfigFor(language.code) },
        clientModule: "/static/vocab.js",
      }),
    );
  });
}

/* ------------------------------------------------------------------
   Fragments
   ------------------------------------------------------------------ */

function flashMessage(query: Record<string, string | undefined>): string {
  if (query["added"] === "word") return alert("ok", "Word added.");
  if (query["added"] === "type") return alert("ok", "Category added.");
  if (query["added"] === "language")
    return alert("ok", "Language created with a starter set of categories.");
  if (query["saved"]) return alert("ok", "Changes saved.");
  if (query["deleted"]) return alert("ok", "Word deleted.");
  if (query["error"] === "duplicate")
    return alert(
      "error",
      `“${query["dup"] ?? "That word"}” is already in your list. Edit that entry instead — a second meaning can go in with a slash.`,
    );
  if (query["error"] === "word")
    return alert("error", "That word could not be saved — check the fields and try again.");
  if (query["error"]) return alert("error", "Something in that form was not valid.");
  return "";
}

function firstLanguageCard(): string {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icons.globe}</div>
    <h2>Add your first language</h2>
    <p>Name the language you are learning. A starter set of categories — nouns, verbs, phrases and so on — is created with it, and you can change them at any time.</p>
    <form method="post" action="/languages" class="row" style="justify-content:center;margin-top:14px" autocomplete="off">
      <input class="input" name="name" placeholder="French" required style="width:190px" autofocus ${NO_AUTOFILL}>
      <button class="btn btn-primary" type="submit">${icons.plus}Create language</button>
    </form>
  </div></div>`;
}

/**
 * The add form's example entry, in the language being added to. It was always
 * French ("la femme"), which read oddly on a Spanish list. Languages without
 * an example here get a neutral hint rather than someone else's word.
 */
const EXAMPLE_WORDS: Record<string, string> = {
  fr: "la femme",
  es: "la mujer",
  it: "la donna",
  de: "die Frau",
  pt: "a mulher",
  nl: "de vrouw",
};

function exampleFor(languageCode: string): { term: string; english: string } {
  // Codes may carry a region (fr-FR); the example goes by the language.
  const base = (languageCode || "").split(/[-_]/)[0]!.toLowerCase();
  const term = EXAMPLE_WORDS[base];
  return term ? { term, english: "the woman" } : { term: "a word or phrase", english: "what it means" };
}

function addWordCard(
  languageId: number,
  types: { id: number; name: string }[],
  selectedType: number | null,
  autofocus: boolean,
  languageCode: string,
): string {
  const example = exampleFor(languageCode);

  if (types.length === 0) {
    return `<div class="card"><div class="card-body">
      ${alert("info", "Add a category below before you can add words.")}
    </div></div>`;
  }

  // Category and the mode flags are set once and stay put; only the two text
  // fields are retyped. Without JavaScript this still posts to /words and
  // reloads, so the page degrades rather than breaking.
  return `<div class="card">
    <div class="card-head">
      <div><h2>Add words</h2>
        <div class="sub">Type, <kbd>Tab</kbd>, type, <kbd>Enter</kbd> — it stays focused so you can keep going.</div>
      </div>
      <span class="pill pill-plain" id="added-count" hidden>0 added</span>
    </div>
    <div class="card-body">
      <form method="post" action="/words" class="stack-sm" id="add-word-form" autocomplete="off">
        <div class="row add-settings">
          <div class="field" style="flex:0 1 200px">
            <label for="wordTypeId">Category</label>
            <select class="select" id="wordTypeId" name="wordTypeId" required>
              ${types
                .map(
                  (t) =>
                    `<option value="${t.id}"${t.id === selectedType ? " selected" : ""}>${esc(t.name)}</option>`,
                )
                .join("")}
            </select>
          </div>
          <label class="check"><input type="checkbox" name="writtenEnabled" checked> Written practice</label>
          <label class="check"><input type="checkbox" name="audioEnabled" checked> Listening practice</label>
        </div>

        <div class="add-row">
          <div class="field">
            <label for="term">Word or phrase</label>
            <input class="input" id="term" name="term" required${autofocus ? " data-autofocus" : ""}
                   ${NO_AUTOFILL} autocapitalize="off" spellcheck="false" placeholder="${esc(example.term)}">
          </div>
          <div class="field">
            <label for="english">English</label>
            <input class="input" id="english" name="english" required
                   ${NO_AUTOFILL} spellcheck="false" placeholder="${esc(example.english)}">
          </div>
          <button class="btn btn-primary" type="submit">${icons.plus}Add</button>
        </div>

        <div id="accent-bar-slot"></div>
        <div id="add-feedback" class="add-feedback" hidden></div>
        <input type="hidden" name="language" value="${languageId}">
      </form>
    </div>
  </div>`;
}

function displayRow(
  row: {
    id: number;
    term: string;
    english: string;
    wordTypeName: string;
    writtenEnabled: boolean;
    audioEnabled: boolean;
    notes: string | null;
  },
  /** null when the word is switched off for the mode being shown. */
  score: number | null,
  languageId: number,
  filters: ListFilters,
): string {
  const modes = [
    row.writtenEnabled ? `<span class="pill pill-plain">Written</span>` : "",
    row.audioEnabled ? `<span class="pill pill-plain">Listen</span>` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<tr id="word-${row.id}" data-word-id="${row.id}">
    <td class="term"><a class="term-link" href="${esc(vocabUrl(languageId, filters, { word: row.id }))}">${esc(row.term)}</a>${
      row.notes ? `<div class="hint">${esc(row.notes)}</div>` : ""
    }</td>
    <td>${esc(row.english)}</td>
    <td class="col-type"><span class="pill pill-plain">${esc(row.wordTypeName)}</span></td>
    <td>${
      score === null
        ? `<span class="pill pill-plain" title="Not included in ${filters.mode === "audio" ? "listening" : "written"} practice">Off</span>`
        : `${scorePill(score)} <span class="hint num col-score">${score.toFixed(2)}</span>`
    }</td>
    <td class="col-modes">${modes || `<span class="hint">none</span>`}</td>
    <td><a class="btn btn-sm btn-ghost" data-edit="${row.id}" href="${esc(`${vocabUrl(languageId, filters, { edit: row.id })}#word-${row.id}`)}">Edit</a></td>
  </tr>`;
}

function editRow(
  row: {
    id: number;
    term: string;
    english: string;
    wordTypeId: number;
    writtenEnabled: boolean;
    audioEnabled: boolean;
    notes: string | null;
  },
  types: { id: number; name: string }[],
  languageId: number,
  filters: ListFilters,
): string {
  return `<tr id="word-${row.id}" data-word-id="${row.id}" class="edit-row">
    <td colspan="6" style="padding:14px 16px">
      <form method="post" action="/words/${row.id}" class="stack-sm" data-word-form autocomplete="off">
        <input type="hidden" name="_type" value="${filters.type ?? ""}">
        <input type="hidden" name="_q" value="${esc(filters.q ?? "")}">
        <input type="hidden" name="_sort" value="${filters.sort ?? ""}">
        <input type="hidden" name="_mode" value="${filters.mode ?? ""}">
        <div class="form-grid">
          <div class="field"><label>Word</label>
            <input class="input" name="term" required value="${esc(row.term)}" ${NO_AUTOFILL}></div>
          <div class="field"><label>English</label>
            <input class="input" name="english" required value="${esc(row.english)}" ${NO_AUTOFILL}></div>
          <div class="field"><label>Category</label>
            <select class="select" name="wordTypeId">
              ${types
                .map(
                  (t) =>
                    `<option value="${t.id}"${t.id === row.wordTypeId ? " selected" : ""}>${esc(t.name)}</option>`,
                )
                .join("")}
            </select></div>
          <div class="field"><label>Note</label>
            <input class="input" name="notes" value="${esc(row.notes ?? "")}" ${NO_AUTOFILL}></div>
        </div>
        <div class="row">
          <label class="check"><input type="checkbox" name="writtenEnabled"${row.writtenEnabled ? " checked" : ""}> Written</label>
          <label class="check"><input type="checkbox" name="audioEnabled"${row.audioEnabled ? " checked" : ""}> Listening</label>
          <span class="spacer"></span>
          <span class="hint edit-keys"><kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels</span>
          <a class="btn btn-sm" data-cancel href="${esc(`${vocabUrl(languageId, filters)}#word-${row.id}`)}">Cancel</a>
          <button class="btn btn-sm btn-primary" type="submit">${icons.check}Save</button>
        </div>
      </form>
      <form method="post" action="/words/${row.id}" data-word-form
            onsubmit="return confirm('Delete this word and its progress? This cannot be undone.')"
            style="margin-top:10px">
        <input type="hidden" name="_action" value="delete">
        <input type="hidden" name="_type" value="${filters.type ?? ""}">
        <input type="hidden" name="_q" value="${esc(filters.q ?? "")}">
        <input type="hidden" name="_sort" value="${filters.sort ?? ""}">
        <input type="hidden" name="_mode" value="${filters.mode ?? ""}">
        <button class="btn btn-sm btn-danger" type="submit">${icons.trash}Delete word</button>
      </form>
    </td>
  </tr>`;
}

function manageTypesCard(
  languageId: number,
  types: { id: number; name: string }[],
): string {
  return `<div class="card">
    <div class="card-head"><div><h2>Categories</h2><div class="sub">Group words however suits the language.</div></div></div>
    <div class="card-body">
      <div class="row" style="margin-bottom:14px">
        ${
          types.length > 0
            ? types.map((t) => `<span class="pill pill-plain">${esc(t.name)}</span>`).join(" ")
            : `<span class="hint">No categories yet.</span>`
        }
      </div>
      <form method="post" action="/word-types" class="row" autocomplete="off">
        <input type="hidden" name="languageId" value="${languageId}">
        <input class="input" name="name" placeholder="conjugations" required style="width:200px" ${NO_AUTOFILL}>
        <button class="btn" type="submit">${icons.plus}Add category</button>
      </form>
    </div>
  </div>`;
}
