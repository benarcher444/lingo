/**
 * AI provider abstraction.
 *
 * The tutor pipeline is provider-agnostic: it asks for a completion given a
 * system prompt and a conversation, and does not care who answers. Which
 * provider runs is a config value, not a code change.
 *
 * Configure in .env:
 *
 *   AI_PROVIDER=openai        # openai | anthropic | none
 *   AI_MODEL=gpt-4o-mini      # optional; each provider has a sensible default
 *   OPENAI_API_KEY=sk-...     # whichever provider you chose
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * With AI_PROVIDER unset it picks whichever key is present, preferring
 * Anthropic — the owner's choice. (It preferred OpenAI, which the original
 * terminal app used, until the owner asked to switch.)
 *
 * Any key here is API billing, separate from a Claude or ChatGPT subscription.
 */

export type ProviderName = "openai" | "anthropic" | "mock" | "none";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatTurn[];
  /** Rough steer on how much thought the task deserves. */
  effort: "low" | "medium";
  maxTokens?: number;
  /** Which tutor role is asking. Lets the test stand-in answer in kind. */
  purpose?: "interpreter" | "partner" | "teacher";
}

export interface Provider {
  readonly name: ProviderName;
  readonly model: string;
  complete(request: CompletionRequest): Promise<string>;
}

const DEFAULT_MODELS: Record<"openai" | "anthropic", string> = {
  // What the original app used, modernised — 3.5-turbo is long superseded.
  openai: "gpt-4o-mini",
  anthropic: "claude-opus-5",
};

/** Explicit config wins; otherwise fall back to whichever key exists. */
function resolveProviderName(): ProviderName {
  const configured = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();

  if (configured === "openai" || configured === "anthropic" || configured === "mock" || configured === "none") {
    return configured;
  }

  if (configured !== "") {
    console.warn(
      `AI_PROVIDER="${configured}" is not recognised — expected openai, anthropic or none.`,
    );
  }

  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

/* ------------------------------------------------------------------
   OpenAI
   ------------------------------------------------------------------ */

class OpenAIProvider implements Provider {
  readonly name = "openai" as const;
  readonly model: string;
  private client: import("openai").default | null = null;

  constructor(model: string) {
    this.model = model;
  }

  private async getClient() {
    if (!this.client) {
      const { default: OpenAI } = await import("openai");
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const client = await this.getClient();

    const response = await client.chat.completions.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 1500,
      // The interpreter step must be literal, so it runs at 0; conversation
      // wants some variation. This mirrors the original app's split.
      temperature: request.effort === "low" ? 0 : 0.7,
      messages: [
        { role: "system", content: request.system },
        ...request.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    return response.choices[0]?.message?.content?.trim() ?? "";
  }
}

/* ------------------------------------------------------------------
   Anthropic
   ------------------------------------------------------------------ */

class AnthropicProvider implements Provider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private client: import("@anthropic-ai/sdk").default | null = null;

  constructor(model: string) {
    this.model = model;
  }

  private async getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 1500,
      system: request.system,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      thinking: { type: "adaptive" },
      output_config: { effort: request.effort === "low" ? "low" : "medium" },
    });

    if (response.stop_reason === "refusal") {
      return "I can't help with that one — try rephrasing.";
    }

    return response.content
      .filter((block): block is import("@anthropic-ai/sdk").Anthropic.TextBlock =>
        block.type === "text",
      )
      .map((block) => block.text)
      .join("\n")
      .trim();
  }
}

/* ------------------------------------------------------------------
   Mock — for tests only
   ------------------------------------------------------------------ */

/**
 * AI_PROVIDER=mock: no network and no cost, and a predictable answer for each
 * role, so the conversation page can be driven end to end (scripts/test-chat.ts).
 * "!nocredit" in the latest message fails the way an account out of credit
 * does. Never set on the server.
 */
class MockProvider implements Provider {
  readonly name = "mock" as const;
  readonly model = "mock";

  async complete(request: CompletionRequest): Promise<string> {
    const latest = request.messages[request.messages.length - 1]?.content ?? "";
    if (latest.includes("!nocredit")) {
      throw Object.assign(new Error("You have no credits remaining."), {
        status: 429,
        code: "credit_balance_exhausted",
        type: "insufficient_quota",
      });
    }

    const turn = request.messages.filter((m) => m.role === "user").length;
    const scene = request.system.match(/^Scene: (.+?)\.?$/m)?.[1] ?? "none";
    const level = request.system.match(/level ([ABC][12])/)?.[1] ?? "?";

    switch (request.purpose) {
      case "interpreter":
        return `Corrigé : ${latest}`;
      case "teacher":
        return `Explication ${turn} : ${latest.slice(0, 60)}`;
      default:
        return `[${scene} · ${level}] Réponse ${turn} ?`;
    }
  }
}

/* ------------------------------------------------------------------
   Errors
   ------------------------------------------------------------------ */

/** How an AI request failed, in terms the learner can act on. */
export type AIErrorKind = "no_credit" | "bad_key" | "rate_limited" | "upstream";

/**
 * Sorts a provider error. Out of credit matters most: it is the one the owner
 * must act on. OpenAI reports it as a 429 that looks like rate limiting
 * (insufficient_quota / credit_balance_exhausted); Anthropic as a 400 whose
 * message mentions the credit balance.
 */
export function classifyAIError(error: unknown): AIErrorKind {
  const e = (error ?? {}) as {
    status?: number;
    code?: string;
    type?: string;
    message?: string;
    error?: { code?: string; type?: string; message?: string; error?: { type?: string; message?: string } };
  };
  const code = e.code ?? e.error?.code;
  const type = e.type ?? e.error?.type;
  const text = `${e.message ?? ""} ${e.error?.message ?? ""} ${e.error?.error?.message ?? ""}`.toLowerCase();

  if (
    code === "insufficient_quota" ||
    code === "credit_balance_exhausted" ||
    type === "insufficient_quota" ||
    /credit balance|no credits|insufficient.quota|billing details/.test(text)
  ) {
    return "no_credit";
  }
  if (e.status === 401 || e.status === 403) return "bad_key";
  if (e.status === 429) return "rate_limited";
  return "upstream";
}

/* ------------------------------------------------------------------
   Selection
   ------------------------------------------------------------------ */

function build(): Provider | null {
  const name = resolveProviderName();
  if (name === "none") return null;
  if (name === "mock") return new MockProvider();

  const model = (process.env.AI_MODEL ?? "").trim() || DEFAULT_MODELS[name];

  const keyVar = name === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[keyVar]) {
    console.warn(`AI_PROVIDER=${name} but ${keyVar} is not set — conversation is off.`);
    return null;
  }

  return name === "openai" ? new OpenAIProvider(model) : new AnthropicProvider(model);
}

/** null when no provider is configured — the chat page checks this and says so. */
export const provider: Provider | null = build();

export function providerLabel(): string {
  if (!provider) return "Not configured";
  const vendor = provider.name === "openai" ? "OpenAI" : provider.name === "anthropic" ? "Anthropic" : "Mock";
  return `${vendor} · ${provider.model}`;
}
