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

export type ProviderName = "openai" | "anthropic" | "none";

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
}

export interface Provider {
  readonly name: ProviderName;
  readonly model: string;
  complete(request: CompletionRequest): Promise<string>;
}

const DEFAULT_MODELS: Record<Exclude<ProviderName, "none">, string> = {
  // What the original app used, modernised — 3.5-turbo is long superseded.
  openai: "gpt-4o-mini",
  anthropic: "claude-opus-5",
};

/** Explicit config wins; otherwise fall back to whichever key exists. */
function resolveProviderName(): ProviderName {
  const configured = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();

  if (configured === "openai" || configured === "anthropic" || configured === "none") {
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
   Selection
   ------------------------------------------------------------------ */

function build(): Provider | null {
  const name = resolveProviderName();
  if (name === "none") return null;

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
  const vendor = provider.name === "openai" ? "OpenAI" : "Anthropic";
  return `${vendor} · ${provider.model}`;
}
