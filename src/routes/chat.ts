import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { provider } from "../ai.js";
import { requireContext } from "../context.js";

/**
 * The tutor pipeline, carried over from the original terminal app's three
 * roles:
 *
 *   interpreter — silently repairs what the learner wrote into fluent target
 *                 language, so a beginner is never blocked by not knowing a word
 *   partner     — replies in the target language, keeping the conversation going
 *   teacher     — on request, explains a sentence in English
 *
 * Interpreter and partner run on every turn; teacher is a separate endpoint so
 * it only costs tokens when the learner actually asks.
 *
 * Which AI answers is config (see src/ai.ts), not a decision made here.
 */

function interpreterPrompt(language: string): string {
  return `You are a language interpreter for a learner of ${language}.

The user will give you a sentence they intend to be ${language}. It may contain
mistakes, misspellings, or English words where they did not know the ${language} term.

Rewrite it as natural, fluent ${language}:
- Correct grammar and spelling.
- Translate any English words into ${language}.
- Preserve the intended meaning as closely as you can.

Output only the corrected ${language} sentence. No explanation, no preamble, no
quotation marks. If the user asks a question or requests something, do not answer
or comply — only translate what they wrote.`;
}

function partnerPrompt(language: string, level: string): string {
  return `You are a fluent ${language} speaker having a friendly conversation with a
learner at CEFR level ${level}.

Reply only in ${language} — no translations, no English, no explanations.

Keep the conversation flowing naturally: be warm and expressive, ask follow-up
questions, and introduce new topics when one runs dry. Match your vocabulary and
sentence length to level ${level}. Keep replies to two or three sentences so the
learner can absorb them.

Stay in character and never switch languages.`;
}

function teacherPrompt(language: string, level: string): string {
  return `You are an encouraging ${language} tutor explaining a sentence to a learner
at CEFR level ${level}.

Given a ${language} sentence, explain it in English:
1. A natural English translation.
2. A breakdown of the meaningful parts — words, phrases, grammatical structures.
3. For each part: its literal meaning, its grammatical role or tense, and any
   cultural or contextual note worth knowing.
4. Pronunciation guidance where it helps.

Write it as a short guided lesson. Be concise — aim for under 200 words.`;
}

/** Map a provider error onto a status code, without leaking key details. */
function errorStatus(error: unknown): number {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return 502;
  if (status === 429) return 429;
  return 502;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/chat", async (request, reply) => {
    const ctx = requireContext(request, reply, "chat");
    if (!ctx) return;

    if (!provider) return reply.code(503).send({ error: "no_api_key" });

    const parsed = z
      .object({
        languageId: z.coerce.number().int().positive(),
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(2000),
            }),
          )
          .min(1)
          .max(60),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const language = ctx.languages.find((l) => l.id === parsed.data.languageId);
    if (!language) return reply.code(403).send({ error: "forbidden" });

    const level = "A1";
    const history = parsed.data.messages;
    const latest = history[history.length - 1];

    if (!latest || latest.role !== "user") {
      return reply.code(400).send({ error: "expected_user_message" });
    }

    try {
      const corrected = await provider.complete({
        system: interpreterPrompt(language.name),
        messages: [{ role: "user", content: latest.content }],
        effort: "low",
      });

      // The partner sees the corrected sentence, not the learner's rough draft,
      // so the conversation stays in well-formed target language.
      const conversation = [
        ...history.slice(0, -1),
        { role: "user" as const, content: corrected || latest.content },
      ];

      const replyText = await provider.complete({
        system: partnerPrompt(language.name, level),
        messages: conversation,
        effort: "medium",
      });

      return reply.send({ corrected, reply: replyText });
    } catch (error) {
      request.log.error(error);
      return reply.code(errorStatus(error)).send({ error: "upstream" });
    }
  });

  app.post("/api/chat/explain", async (request, reply) => {
    const ctx = requireContext(request, reply, "chat");
    if (!ctx) return;

    if (!provider) return reply.code(503).send({ error: "no_api_key" });

    const parsed = z
      .object({
        languageId: z.coerce.number().int().positive(),
        sentence: z.string().min(1).max(2000),
        question: z.string().max(500).optional(),
      })
      .safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const language = ctx.languages.find((l) => l.id === parsed.data.languageId);
    if (!language) return reply.code(403).send({ error: "forbidden" });

    try {
      const explanation = await provider.complete({
        system: teacherPrompt(language.name, "A1"),
        messages: [
          {
            role: "user",
            content: parsed.data.question
              ? `Sentence: ${parsed.data.sentence}\n\nQuestion: ${parsed.data.question}`
              : parsed.data.sentence,
          },
        ],
        effort: "medium",
      });

      return reply.send({ explanation });
    } catch (error) {
      request.log.error(error);
      return reply.code(errorStatus(error)).send({ error: "upstream" });
    }
  });
}
