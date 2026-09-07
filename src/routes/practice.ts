import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { provider } from "../ai.js";
import type { Mode } from "../algorithm.js";
import { requireContext, typesFor } from "../context.js";
import { buildSession, recordAnswer } from "../practice.js";
import { loadScoredWords, recordSnapshot, summarise, summariseByType } from "../stats.js";
import { emptyState, pageHead, progressBanner } from "../views/components.js";
import { esc, icons, layout } from "../views/layout.js";

const MODE_COPY: Record<Mode, { title: string; sub: string }> = {
  written: {
    title: "Written practice",
    sub: "Each word comes up in both directions and keeps coming back until you get both right.",
  },
  audio: {
    title: "Listening practice",
    sub: "Hear the word, type what you heard. Replay as often as you like.",
  },
};

export async function practiceRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------
     Practice pages
     --------------------------------------------------------------- */

  for (const mode of ["written", "audio"] as Mode[]) {
    app.get(`/practice/${mode}`, async (request, reply) => {
      const ctx = requireContext(request, reply, mode);
      if (!ctx) return;

      const copy = MODE_COPY[mode];

      if (!ctx.currentLanguage) {
        return reply.type("text/html").send(
          layout(ctx, {
            title: copy.title,
            body:
              pageHead({ title: copy.title, sub: copy.sub }) +
              emptyState({
                title: "No language yet",
                body: "Create a language and add some vocabulary, and this is where you will practise it.",
                actionHref: "/vocab",
                actionLabel: "Go to vocabulary",
                icon: icons.globe,
              }),
          }),
        );
      }

      const language = ctx.currentLanguage;
      const scored = loadScoredWords(language.id, mode);

      if (scored.length === 0) {
        return reply.type("text/html").send(
          layout(ctx, {
            title: copy.title,
            body:
              pageHead({ title: copy.title, sub: copy.sub }) +
              emptyState({
                title: "Please add some words to your vocabulary to start",
                body:
                  mode === "audio"
                    ? `There are no ${language.name} words marked for listening practice yet. Add some words — or tick "Listening practice" on words you already have.`
                    : `There are no ${language.name} words marked for written practice yet. Add your first few and this page comes alive.`,
                actionHref: `/vocab?language=${language.id}`,
                actionLabel: "Add words",
                icon: mode === "audio" ? icons.ear : icons.pen,
              }),
          }),
        );
      }

      const types = typesFor(language);
      const summary = summarise(scored, mode);
      const typeSummaries = summariseByType(scored, mode);

      const config = {
        languageId: language.id,
        languageCode: language.code,
        languageName: language.name,
        mode,
        total: scored.length,
        // How many words each category holds, so the "how many" hint can react
        // to the category picker without another request.
        countsByType: Object.fromEntries(
          typeSummaries.map((t) => [t.wordTypeId, t.total]),
        ) as Record<string, number>,
      };

      const body = `
        ${pageHead({ title: copy.title, sub: copy.sub })}
        <div class="stack">
          <div id="overview">
            ${progressBanner({
              summary,
              types: typeSummaries,
              languageName: language.name,
              mode,
            })}
          </div>

          <div id="setup" class="card">
            <div class="card-head"><div><h2>Start a session</h2><div class="sub">Words you know well come up far less often.</div></div></div>
            <div class="card-body">
              <form id="setup-form" class="row">
                <div class="field" style="flex:1;min-width:170px">
                  <label for="wordType">Category</label>
                  <select class="select" id="wordType" name="wordTypeId">
                    <option value="">All categories</option>
                    ${types
                      .map((t) => {
                        const stat = typeSummaries.find((s) => s.wordTypeId === t.id);
                        if (!stat || stat.total === 0) return "";
                        return `<option value="${t.id}">${esc(t.name)} · ${stat.total} words</option>`;
                      })
                      .join("")}
                  </select>
                </div>
                <div class="field" style="width:150px">
                  <label for="count">How many</label>
                  <input class="input" id="count" name="count" type="number"
                         inputmode="numeric" min="0" max="${scored.length}"
                         value="${Math.min(20, scored.length)}" list="count-presets"
                         autocomplete="off">
                  <datalist id="count-presets">
                    <option value="10"></option>
                    <option value="20"></option>
                    <option value="40"></option>
                    <option value="${scored.length}"></option>
                  </datalist>
                  <div class="hint" id="count-hint"></div>
                </div>
                <button class="btn btn-primary btn-lg" type="submit" style="align-self:end">
                  ${icons.arrowRight}Start
                </button>
              </form>
            </div>
          </div>

          <div id="quiz" hidden></div>
          <div id="summary" hidden></div>
        </div>`;

      return reply.type("text/html").send(
        layout(ctx, {
          title: copy.title,
          body,
          clientData: { name: "__practice", value: config },
          clientModule: "/static/practice.js",
        }),
      );
    });
  }

  /* ---------------------------------------------------------------
     Conversation
     --------------------------------------------------------------- */

  app.get("/practice/chat", async (request, reply) => {
    const ctx = requireContext(request, reply, "chat");
    if (!ctx) return;

    const head = pageHead({
      title: "Conversation",
      sub: "Chat in the language you are learning. Your message is corrected first, then answered, and you can ask for a breakdown of anything.",
    });

    if (!ctx.currentLanguage) {
      return reply.type("text/html").send(
        layout(ctx, {
          title: "Conversation",
          body:
            head +
            emptyState({
              title: "No language yet",
              body: "Create a language on the vocabulary page and you can start a conversation here.",
              actionHref: "/vocab",
              actionLabel: "Go to vocabulary",
              icon: icons.globe,
            }),
        }),
      );
    }

    const language = ctx.currentLanguage;
    const wordCount = loadScoredWords(language.id, "written").length;

    if (wordCount === 0) {
      return reply.type("text/html").send(
        layout(ctx, {
          title: "Conversation",
          body:
            head +
            emptyState({
              title: "Please add some words to your vocabulary to start",
              body: `Conversation practice leans on the vocabulary you are building. Add some ${language.name} words first, then come back and talk.`,
              actionHref: `/vocab?language=${language.id}`,
              actionLabel: "Add words",
              icon: icons.chat,
            }),
        }),
      );
    }

    const hasKey = provider !== null;

    const body = `
      ${head}
      <div class="stack">
        ${
          hasKey
            ? ""
            : `<div class="alert alert-info">Conversation needs an AI provider. Set <code>AI_PROVIDER</code> and the matching API key in <code>.env</code>, then restart — see <a href="/settings">Settings</a>.</div>`
        }
        <div class="card">
          <div class="card-head">
            <div><h2>${esc(language.name)} conversation</h2><div class="sub">Write as best you can — mistakes are expected and corrected.</div></div>
            <span class="pill pill-accent">${icons.sparkle}Level A1</span>
          </div>
          <div class="chat-log" id="chat-log">
            <div class="msg">
              <div class="who">Tutor</div>
              <div class="bubble">${
                hasKey
                  ? "Bonjour ! Ready when you are — say anything and I will reply in your target language."
                  : "I am not connected yet. Once an API key is configured I will chat with you here, correct what you write, and explain anything you ask about."
              }</div>
            </div>
          </div>
          <form class="chat-compose" id="chat-form">
            <input class="input" id="chat-input" placeholder="Write something…" autocomplete="off" ${hasKey ? "" : "disabled"}>
            <button class="btn btn-primary" type="submit" ${hasKey ? "" : "disabled"}>Send</button>
          </form>
        </div>
      </div>`;

    return reply.type("text/html").send(
      layout(ctx, {
        title: "Conversation",
        body,
        clientData: {
          name: "__chat",
          value: {
            languageId: language.id,
            languageName: language.name,
            enabled: hasKey,
          },
        },
        clientModule: "/static/chat.js",
      }),
    );
  });

  /* ---------------------------------------------------------------
     API
     --------------------------------------------------------------- */

  app.post("/api/practice/start", async (request, reply) => {
    const ctx = requireContext(request, reply, "written");
    if (!ctx) return;

    const parsed = z
      .object({
        languageId: z.coerce.number().int().positive(),
        mode: z.enum(["written", "audio"]),
        wordTypeId: z.coerce.number().int().positive().nullable().optional(),
        // 0 means "everything", and anything above the pool size is clamped by
        // weightedSample, so a generous ceiling is safe.
        count: z.coerce.number().int().min(0).max(100_000),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    if (!ctx.languages.some((l) => l.id === parsed.data.languageId)) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // Snapshot before the session, so the history shows the starting point.
    recordSnapshot(parsed.data.languageId, parsed.data.mode);

    const cards = buildSession({
      languageId: parsed.data.languageId,
      mode: parsed.data.mode,
      wordTypeId: parsed.data.wordTypeId ?? null,
      count: parsed.data.count,
    });

    return reply.send({ cards });
  });

  app.post("/api/practice/answer", async (request, reply) => {
    const ctx = requireContext(request, reply, "written");
    if (!ctx) return;

    const parsed = z
      .object({
        wordId: z.coerce.number().int().positive(),
        mode: z.enum(["written", "audio"]),
        direction: z.enum(["to_english", "from_english", "listen"]),
        answer: z.string().max(300),
        override: z.boolean().optional(),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const result = recordAnswer({
      userId: ctx.user.id,
      wordId: parsed.data.wordId,
      mode: parsed.data.mode,
      direction: parsed.data.direction,
      given: parsed.data.answer,
      override: parsed.data.override,
    });

    if (!result) return reply.code(404).send({ error: "not_found" });
    return reply.send(result);
  });

  app.post("/api/practice/finish", async (request, reply) => {
    const ctx = requireContext(request, reply, "written");
    if (!ctx) return;

    const parsed = z
      .object({
        languageId: z.coerce.number().int().positive(),
        mode: z.enum(["written", "audio"]),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    if (!ctx.languages.some((l) => l.id === parsed.data.languageId)) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // Snapshot again, so the history reflects the work just done. The original
    // only recorded the "before" state.
    recordSnapshot(parsed.data.languageId, parsed.data.mode);

    const scored = loadScoredWords(parsed.data.languageId, parsed.data.mode);
    return reply.send({ summary: summarise(scored, parsed.data.mode) });
  });
}
