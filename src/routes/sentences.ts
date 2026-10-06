import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { classifyAIError, provider } from "../ai.js";
import { mayUseAI } from "../allowlist.js";
import { LEVELS } from "../chat-scenarios.js";
import { requireContext } from "../context.js";
import {
  composerPrompt,
  dropRound,
  findRound,
  keepRound,
  markerPrompt,
  parseJson,
  pickWords,
  wordList,
} from "../sentences.js";
import { loadScoredWords } from "../stats.js";
import { NO_AUTOFILL, emptyState, pageHead } from "../views/components.js";
import { esc, icons, layout } from "../views/layout.js";

/**
 * Translation practice. Two calls per round: one composes a sentence from the
 * learner's own words, one marks what they wrote. Both answer in JSON, which
 * is what lets the page show mistakes as a list rather than a paragraph.
 *
 * Who may use it is the "ai" column of allowed_emails.csv, as for Conversation:
 * each round costs money.
 */

const WORD_COUNTS = [2, 3, 4, 5] as const;

function sendAIError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.error(error);
  const kind = classifyAIError(error);
  const status = kind === "no_credit" ? 402 : kind === "rate_limited" ? 429 : 502;
  return reply.code(status).send({ error: kind, provider: provider?.name ?? null });
}

const composed = z.object({ target: z.string().min(1).max(400), english: z.string().min(1).max(400) });

const marked = z.object({
  verdict: z.enum(["right", "close", "wrong"]),
  comment: z.string().max(300).default(""),
  corrected: z.string().max(400).default(""),
  notes: z
    .array(
      z.object({
        wrote: z.string().max(200).default(""),
        better: z.string().max(200).default(""),
        why: z.string().max(300).default(""),
      }),
    )
    .max(6)
    .default([]),
});

export async function sentenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/practice/translate", async (request, reply) => {
    const ctx = requireContext(request, reply, "translate");
    if (!ctx) return;

    const head = pageHead({ title: "Translation practice" });
    const page = (body: string) =>
      reply.type("text/html").send(layout(ctx, { title: "Translation practice", body }));

    if (!ctx.currentLanguage) {
      return page(
        head +
          emptyState({
            title: "No language yet",
            body: "Create a language on the vocabulary page, add some words, and they can be built into sentences here.",
            actionHref: "/vocab",
            actionLabel: "Go to vocabulary",
            icon: icons.globe,
          }),
      );
    }

    const language = ctx.currentLanguage;
    const words = loadScoredWords(language.id, "written");

    if (words.length < 2) {
      return page(
        head +
          emptyState({
            title: "Add a few more words first",
            body: `Sentences are built out of your own vocabulary, so this needs at least a couple of ${language.name} words to work with.`,
            actionHref: `/vocab?language=${language.id}`,
            actionLabel: "Add words",
            icon: icons.translate,
          }),
      );
    }

    if (!mayUseAI(ctx.user.email)) {
      return page(
        head +
          emptyState({
            title: "Translation practice isn't switched on for your account",
            body: "It uses the AI, which costs money to run, so the site owner switches it on for each person. Everything else here is yours to use.",
            icon: icons.translate,
          }),
      );
    }

    const countOptions = WORD_COUNTS.filter((n) => n <= words.length)
      .map((n) => `<option value="${n}"${n === 3 ? " selected" : ""}>${n} words</option>`)
      .join("");
    const levelOptions = LEVELS.map(
      (level) => `<option value="${level}"${level === "A1" ? " selected" : ""}>${level}</option>`,
    ).join("");

    const config = {
      languageId: language.id,
      languageName: language.name,
      total: words.length,
    };

    const body = `
      ${head}
      <div class="stack">
        ${
          provider
            ? ""
            : `<div class="alert alert-info">This needs an AI provider. Set <code>AI_PROVIDER</code> and the matching API key in <code>.env</code>, then restart — see <a href="/settings">Settings</a>.</div>`
        }
        <div class="card">
          <div class="card-head">
            <div><h2>${esc(language.name)} sentences</h2>
              <div class="sub" id="tr-sub">Built from your own words. Scores are not affected.</div></div>
          </div>
          <div class="card-body">
            <form class="row setup-row" id="tr-setup" autocomplete="off">
              <div class="field setup-category">
                <label for="tr-count">How many words</label>
                <select class="select" id="tr-count">${countOptions}</select>
              </div>
              <div class="field setup-category">
                <label for="tr-weighting">Drawn from</label>
                <select class="select" id="tr-weighting">
                  <option value="due" selected>Words you're learning</option>
                  <option value="any">Any words</option>
                </select>
              </div>
              <div class="field setup-count">
                <label for="tr-level">Level</label>
                <select class="select" id="tr-level">${levelOptions}</select>
              </div>
              <button class="btn btn-primary btn-lg setup-start" type="submit" ${provider ? "" : "disabled"}>
                ${icons.arrowRight}Start
              </button>
            </form>

            <div id="tr-round" hidden>
              <div class="tr-prompt">
                <div class="tr-label">Write this in ${esc(language.name)}</div>
                <div class="tr-english" id="tr-english"></div>
              </div>

              <div class="row" style="margin-top:10px">
                <button class="btn btn-sm" type="button" id="tr-hint">Show the words</button>
                <span class="tr-words" id="tr-words" hidden></span>
              </div>

              <form id="tr-form" autocomplete="off">
                <textarea class="input tr-answer" id="tr-answer" rows="2"
                          placeholder="Your ${esc(language.name)}" ${NO_AUTOFILL} spellcheck="false"></textarea>
                <div class="row">
                  <button class="btn btn-primary" type="submit" id="tr-check">Check</button>
                  <button class="btn btn-ghost" type="button" id="tr-skip">New sentence</button>
                </div>
              </form>

              <div id="tr-result"></div>
            </div>
          </div>
        </div>
      </div>`;

    return reply.type("text/html").send(
      layout(ctx, {
        title: "Translation practice",
        body,
        clientData: { name: "__translate", value: config },
        clientModule: "/static/sentences.js",
      }),
    );
  });

  /** A round: pick the words, have the AI build a sentence around them. */
  app.post("/api/sentences/round", async (request, reply) => {
    const ctx = requireContext(request, reply, "translate");
    if (!ctx) return;

    if (!provider) return reply.code(503).send({ error: "no_api_key" });
    if (!mayUseAI(ctx.user.email)) return reply.code(403).send({ error: "ai_not_allowed" });

    const parsed = z
      .object({
        languageId: z.coerce.number().int().positive(),
        count: z.coerce.number().int().min(1).max(5).default(3),
        level: z.enum(LEVELS).default("A1"),
        weighting: z.enum(["due", "any"]).default("due"),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const { languageId, count, level, weighting } = parsed.data;
    const language = ctx.languages.find((l) => l.id === languageId);
    if (!language) return reply.code(403).send({ error: "forbidden" });

    const picked = pickWords(languageId, count, weighting);
    if (picked.length === 0) return reply.code(400).send({ error: "no_words" });

    const words = picked.map((w) => ({ term: w.term, english: w.english }));

    try {
      const answer = await provider.complete({
        purpose: "composer",
        system: composerPrompt(language.name, level),
        messages: [{ role: "user", content: wordList(words) }],
        effort: "medium",
      });

      const sentence = composed.safeParse(parseJson(answer));
      if (!sentence.success) return reply.code(502).send({ error: "upstream" });

      const round = keepRound({
        userId: ctx.user.id,
        languageId,
        languageName: language.name,
        level,
        words,
        english: sentence.data.english,
        target: sentence.data.target,
      });

      // The model answer stays on the server until the round is marked.
      return reply.send({ roundId: round.id, english: round.english, words });
    } catch (error) {
      return sendAIError(request, reply, error);
    }
  });

  /** Mark an attempt, then let the round go. */
  app.post("/api/sentences/check", async (request, reply) => {
    const ctx = requireContext(request, reply, "translate");
    if (!ctx) return;

    if (!provider) return reply.code(503).send({ error: "no_api_key" });
    if (!mayUseAI(ctx.user.email)) return reply.code(403).send({ error: "ai_not_allowed" });

    const parsed = z
      .object({ roundId: z.string().min(1).max(64), answer: z.string().trim().min(1).max(600) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const round = findRound(parsed.data.roundId, ctx.user.id);
    if (!round) return reply.code(410).send({ error: "round_expired" });

    try {
      const answer = await provider.complete({
        purpose: "marker",
        system: markerPrompt(round.languageName, round.level),
        messages: [
          {
            role: "user",
            content: `English: ${round.english}\nModel answer: ${round.target}\nLearner wrote: ${parsed.data.answer}`,
          },
        ],
        effort: "medium",
      });

      const result = marked.safeParse(parseJson(answer));
      if (!result.success) return reply.code(502).send({ error: "upstream" });

      dropRound(round.id);
      return reply.send({ ...result.data, model: round.target, words: round.words });
    } catch (error) {
      return sendAIError(request, reply, error);
    }
  });
}
