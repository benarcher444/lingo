import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { classifyAIError, provider, type ChatTurn } from "../ai.js";
import { mayUseAI } from "../allowlist.js";
import { LEVELS, SCENES, SCENE_KEYS, type Level, type SceneKey } from "../chat-scenarios.js";
import { requireContext } from "../context.js";

/**
 * The tutor, carried over from the original terminal app's three roles:
 *
 *   interpreter — silently repairs what the learner wrote into fluent target
 *                 language, so a beginner is never blocked by a missing word
 *   partner     — the conversation itself: opens it, drives it, and replies
 *   teacher     — explains in English, and takes follow-up questions
 *
 * The prompts keep the original's wording. What is new: the partner always
 * opens (the original only did for roleplay), a scene can be chosen, and the
 * level is the learner's choice rather than a fixed A1.
 *
 * Which AI answers is config (see src/ai.ts), not a decision made here. Who
 * may use it is the "ai" column of allowed_emails.csv (see src/allowlist.ts),
 * because every call costs money.
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

function sceneBlock(scene: SceneKey, custom: string | undefined): string {
  if (scene === "general") {
    return `Scene: open conversation.
This is a free conversation, and it is your job to make it interesting. Do not open
with small talk about how the learner is or how their day has been. Open with
something specific and easy to answer: an opinion to agree or disagree with, a choice
between two things, a small "what would you do if…", or something you have just done
that invites a reaction. Then build on what the learner says: pick up a detail and
take it somewhere. Every few turns, move to a fresh subject, and vary them (food,
travel, films, habits, plans, childhood, work, the weekend).`;
  }

  const label = scene === "custom" ? "the learner's own" : SCENES[scene].label;
  const setting =
    scene === "custom"
      ? `a scene the learner chose: "${custom ?? ""}". Decide sensibly who you are in it`
      : SCENES[scene].scene;

  return `Scene: ${label}.
This is a roleplay set in ${setting}. Set the scene in your first message and play
your part. Stay in the scene and move it forward one step at a time, the way the
real situation would unfold.`;
}

function partnerPrompt(language: string, level: Level, scene: SceneKey, custom?: string): string {
  return `You are a fluent ${language} speaker and teacher. The learner writes to you in
${language}, and you respond only in ${language}, with no translations or explanations
in any other language.

Your goal is to keep the conversation flowing naturally. Be engaging, expressive and
conversational. Ask follow-up questions, introduce new topics and guide the dialogue,
just like in a real-life chat. You can roleplay or add personality if it helps.

${sceneBlock(scene, custom)}

You lead. The learner is here to practise responding, so every message you send ends
with something for them to answer: a question, a choice, or a turn in the situation
that needs a reply. Keep each message to two or three short sentences, so it can be
read and heard in one go.

The learner is level ${level}: match your vocabulary and grammar to it.

Stay fully in character and never switch languages.`;
}

function teacherPrompt(language: string, level: Level): string {
  return `You are an expert ${language} tutor helping a learner at level ${level} understand
${language}. Your explanations must be clear, complete and engaging on their own.
When given a ${language} message:

1. Translate it into natural English.
2. Break it into meaningful parts (words, phrases, grammatical structures).
3. For each part, explain the literal meaning, the grammatical role or tense, any
   relevant cultural or contextual note, and how it contributes to the whole.
4. Include pronunciation guidance where it helps.

Write it as a friendly, encouraging guided lesson, in English. Be concise: under 200
words.

The learner may then ask follow-up questions. Answer them in English, briefly and
directly.`;
}

/**
 * Every conversation opens with this, never shown to the learner. The AI speaks
 * first, and Anthropic requires the first message to be the user's.
 */
const KICKOFF: ChatTurn = { role: "user", content: "(The learner has arrived. Open the conversation.)" };

const setupFields = {
  languageId: z.coerce.number().int().positive(),
  scene: z.enum(SCENE_KEYS).default("general"),
  custom: z.string().trim().max(200).optional(),
  level: z.enum(LEVELS).default("A1"),
};

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

/**
 * An AI failure, as something the page can explain. Out of credit gets its own
 * answer: it is the one the owner has to act on. No key details leave the server.
 */
function sendAIError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  request.log.error(error);
  const kind = classifyAIError(error);
  const status = kind === "no_credit" ? 402 : kind === "rate_limited" ? 429 : 502;
  return reply.code(status).send({ error: kind, provider: provider?.name ?? null });
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /** The partner opens: the AI speaks first, whatever the scene. */
  app.post("/api/chat/start", async (request, reply) => {
    const ctx = requireContext(request, reply, "chat");
    if (!ctx) return;

    if (!provider) return reply.code(503).send({ error: "no_api_key" });
    if (!mayUseAI(ctx.user.email)) return reply.code(403).send({ error: "ai_not_allowed" });

    const parsed = z.object(setupFields).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const { languageId, scene, custom, level } = parsed.data;
    const language = ctx.languages.find((l) => l.id === languageId);
    if (!language) return reply.code(403).send({ error: "forbidden" });
    if (scene === "custom" && !custom) return reply.code(400).send({ error: "describe_scene" });

    try {
      const opener = await provider.complete({
        purpose: "partner",
        system: partnerPrompt(language.name, level, scene, custom),
        messages: [KICKOFF],
        effort: "medium",
      });
      return reply.send({ reply: opener });
    } catch (error) {
      return sendAIError(request, reply, error);
    }
  });

  /** A learner turn: corrected by the interpreter, then answered by the partner. */
  app.post("/api/chat", async (request, reply) => {
    const ctx = requireContext(request, reply, "chat");
    if (!ctx) return;

    if (!provider) return reply.code(503).send({ error: "no_api_key" });
    if (!mayUseAI(ctx.user.email)) return reply.code(403).send({ error: "ai_not_allowed" });

    const parsed = z
      .object({ ...setupFields, messages: z.array(turn).min(1).max(80) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const { languageId, scene, custom, level, messages } = parsed.data;
    const language = ctx.languages.find((l) => l.id === languageId);
    if (!language) return reply.code(403).send({ error: "forbidden" });

    const latest = messages[messages.length - 1];
    if (!latest || latest.role !== "user") {
      return reply.code(400).send({ error: "expected_user_message" });
    }

    try {
      const corrected = await provider.complete({
        purpose: "interpreter",
        system: interpreterPrompt(language.name),
        messages: [{ role: "user", content: latest.content }],
        effort: "low",
      });

      // The partner sees the corrected sentence, not the learner's rough draft,
      // so the conversation stays in well-formed target language — as in the
      // original, where the interpreter's output was what joined the history.
      const conversation: ChatTurn[] = [
        KICKOFF,
        ...messages.slice(0, -1),
        { role: "user", content: corrected || latest.content },
      ];

      const replyText = await provider.complete({
        purpose: "partner",
        system: partnerPrompt(language.name, level, scene, custom),
        messages: conversation,
        effort: "medium",
      });

      return reply.send({ corrected, reply: replyText });
    } catch (error) {
      return sendAIError(request, reply, error);
    }
  });

  /**
   * The teacher, about one message. The first call explains it; later calls
   * carry on the thread with the learner's follow-up questions, as the
   * original's "Do you need anything further explaining?" loop did.
   */
  app.post("/api/chat/teacher", async (request, reply) => {
    const ctx = requireContext(request, reply, "chat");
    if (!ctx) return;

    if (!provider) return reply.code(503).send({ error: "no_api_key" });
    if (!mayUseAI(ctx.user.email)) return reply.code(403).send({ error: "ai_not_allowed" });

    const parsed = z
      .object({
        languageId: setupFields.languageId,
        level: setupFields.level,
        context: z.string().min(1).max(4000),
        messages: z.array(turn).max(40).default([]),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const { languageId, level, context, messages } = parsed.data;
    const language = ctx.languages.find((l) => l.id === languageId);
    if (!language) return reply.code(403).send({ error: "forbidden" });

    const last = messages[messages.length - 1];
    if (last && last.role !== "user") return reply.code(400).send({ error: "expected_user_message" });

    try {
      const explanation = await provider.complete({
        purpose: "teacher",
        system: teacherPrompt(language.name, level),
        messages: [{ role: "user", content: context }, ...messages],
        effort: "medium",
      });
      return reply.send({ explanation });
    } catch (error) {
      return sendAIError(request, reply, error);
    }
  });
}
