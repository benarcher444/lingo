# Playbook: adding AI to an app

You are an AI coding agent. This file is the companion to `PLAYBOOK.md` and
covers one subject: wiring a large language model into the app you are
building, so it works, costs little, can be tested without spending money, and
cannot leak a key.

**Read it before writing any AI code.** It is the distilled practice of a
deployed app that uses a model for several different jobs. None of it is
aspirational.

Everything below is written in TypeScript against Node, because that is what
`PLAYBOOK.md` builds. The shape — one interface, providers behind it — carries
over to any language.

---

## Contents

1. [First, decide whether you need it](#1-first-decide-whether-you-need-it)
2. [The one rule: one interface, providers behind it](#2-the-one-rule-one-interface-providers-behind-it)
3. [Configuration, and the env template](#3-configuration-and-the-env-template)
4. [Which model, and what it costs](#4-which-model-and-what-it-costs)
5. [The Anthropic call, correctly](#5-the-anthropic-call-correctly)
6. [The mock provider — build this first](#6-the-mock-provider--build-this-first)
7. [Errors the user can act on](#7-errors-the-user-can-act-on)
8. [Getting structured data back](#8-getting-structured-data-back)
9. [Writing the prompts](#9-writing-the-prompts)
10. [Security and cost control](#10-security-and-cost-control)
11. [Verification](#11-verification)
12. [Deployment](#12-deployment)
13. [Traps that cost us time](#13-traps-that-cost-us-time)

---

## 1. First, decide whether you need it

An AI feature costs real money per use, fails in ways nothing else in the app
does, and cannot be tested for free unless you build for that from the start.
So before adding one, check it is the thing the owner actually asked for. A
feature that could be a lookup table, a regex or a sort **should** be one.

Where a model genuinely earns its place: open-ended text the app cannot
enumerate (conversation, explanation, free-text marking), judgement over
natural language, or generating examples from the user's own data.

If the app has no such feature, skip this file entirely.

---

## 2. The one rule: one interface, providers behind it

**Which provider answers is a configuration value, never a code decision.**
Everything that wants a completion calls one function and does not know or care
who served it. This is the single most important decision in this file, for
three reasons: the owner gets to choose the vendor (it is their bill), a free
stand-in can be slotted in for tests, and a second provider is a new class
rather than a change to every feature.

Create `src/ai.ts` as the only file in the app that imports a vendor SDK.

```ts
export type ProviderName = "anthropic" | "openai" | "mock" | "none";

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
  /** Which job is asking. Lets the test stand-in answer in kind. */
  purpose?: string;
}

export interface Provider {
  readonly name: ProviderName;
  readonly model: string;
  complete(request: CompletionRequest): Promise<string>;
}

/** null when nothing is configured — every caller checks this. */
export const provider: Provider | null = build();
```

Three rules about that interface:

- **`provider` is `null` when no key is configured, and that is a normal
  state.** The app must boot, serve every other page, and show the AI feature
  as unavailable with a reason. It must not crash, and it must not pretend the
  feature is there and then fail on click. Local development without a key is
  the common case.
- **`purpose` is what makes the mock useful.** Pass a short label naming the
  job ("interpreter", "marker", "summariser") and the stand-in can answer
  plausibly for each one.
- **Import the SDK lazily**, inside the method, not at the top of the file. The
  app then starts without the dependency resolved and pays nothing for a
  provider it never uses.

```ts
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
  // complete() — see section 5
}
```

Selection: explicit config wins; otherwise fall back to whichever key is
present. Warn and return `null` rather than throwing if the named provider has
no key.

```ts
function resolveProviderName(): ProviderName {
  const configured = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (["anthropic", "openai", "mock", "none"].includes(configured)) {
    return configured as ProviderName;
  }
  if (configured !== "") console.warn(`AI_PROVIDER="${configured}" is not recognised.`);
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "none";
}
```

---

## 3. Configuration, and the env template

Four variables, no more. Put them in `env.example` — **no leading dot**, so the
`.env*` ignore rule does not swallow the template — with the real values only
ever in `.env`.

```
# ---------------------------------------------------------------------------
# AI features
# ---------------------------------------------------------------------------
# Which provider answers. One of: anthropic | openai | none
# Leave unset and it uses whichever key is present, preferring Anthropic.
#
# An API key is billed per use, SEPARATELY from any Claude or ChatGPT
# subscription. A Pro or Plus plan does not include API access.
# Create one at console.anthropic.com (or platform.openai.com).
AI_PROVIDER=anthropic

# Optional. Overrides the provider's default model. See the table in
# AI-PLAYBOOK.md section 4 before changing this — it is the cost dial.
# AI_MODEL=claude-sonnet-5-5

# Set the key for whichever provider you chose. Never commit this file.
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...

# Check it works before relying on it:  npm run ai:check
```

**Say the subscription thing out loud when it comes up.** An owner who pays for
Claude Pro or ChatGPT Plus will reasonably assume the API is included. It is
not, and finding out through a confusing 400 is a bad first experience. Put it
in the template, as above, and say it in conversation.

---

## 4. Which model, and what it costs

**Default to `claude-opus-5-5`.** It is the current Opus, and the right starting
point unless the owner says otherwise. Never quietly pick a cheaper model to
save their money — tell them the numbers and let them choose.

| Model | ID | Input $/1M | Output $/1M |
|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | $4.00 | $20.00 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2.00 | $10.00 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 | $0.50 |

Use the exact ID strings. **Never append a date suffix** —
`claude-opus-5-5`, not `claude-opus-5-5-20260401`. A date-suffixed ID you half
remember is probably wrong.

Guidance that has held up: a short, well-constrained job (rewriting one
sentence, marking one answer, classifying) runs fine on Sonnet or Haiku and the
difference is hard to see. Anything asking for judgement, or holding a long
conversation in character, is visibly better on Opus. Make the model one env
variable so this is a config change and the owner can try both.

If the owner asks about costs, do the arithmetic for their actual usage rather
than quoting the table. A few hundred short exchanges a month is pennies; it is
worth saying so, because people assume otherwise and under-build as a result.

---

## 5. The Anthropic call, correctly

This API changed in 2025–26. Several patterns you may half remember are now
rejected outright. The current shape:

```ts
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

  // A safety decline is a 200 with stop_reason "refusal", not an exception.
  // Check it before reading content, or you will return an empty string.
  if (response.stop_reason === "refusal") {
    return "I can't help with that one — try rephrasing.";
  }

  return response.content
    .filter((b): b is import("@anthropic-ai/sdk").Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
```

What matters in that, and what breaks if you get it wrong:

- **`thinking: { type: "adaptive" }`.** The old
  `{ type: "enabled", budget_tokens: N }` is **removed** on current models and
  returns a 400. There is no thinking budget any more.
- **`output_config: { effort: ... }`** is the depth and spend dial — `low`,
  `medium`, `high`, `xhigh`, `max`. It goes inside `output_config`, not at the
  top level. On `claude-opus-5-5` the default is `medium`, so set it
  explicitly if you care.
- **`thinking: { type: "disabled" }` is a 400** on current models. To spend
  less, lower `effort`; do not try to turn thinking off.
- **`system` is its own top-level parameter**, not a message with
  `role: "system"`.
- **`response.content` is an array of blocks**, a discriminated union. Narrow on
  `b.type === "text"` before touching `.text`, or TypeScript rejects it and at
  runtime you may be reading a thinking block.
- **Assistant prefill is gone.** Seeding the reply by ending `messages` with an
  assistant turn returns a 400. Constrain the output through the system prompt
  instead (section 8).
- **`max_tokens` is a hard ceiling that truncates mid-sentence.** Do not
  lowball it. ~1500 is fine for a chat turn; a long document needs far more,
  and anything large should stream (`client.messages.stream(...)` plus
  `.finalMessage()`) or it will hit the HTTP timeout.
- **The first message must be `role: "user"`.** If your feature wants the model
  to open the conversation, send a hidden kickoff user message — "introduce
  yourself and begin" — and do not render it.

Optionally, for an app where a safety decline would be disruptive, Anthropic can
re-run the request on a fallback model inside the same call: add
`betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"` on
`client.beta.messages.create`. Tell the owner if you turn it on. For most apps,
handling `stop_reason === "refusal"` as above is enough.

**OpenAI, if the owner picks it,** is a parallel class with the same
`complete()` signature — `client.chat.completions.create`, `system` as the
first element of `messages`, and `temperature` (0 for literal work, ~0.7 for
conversation) where Anthropic has `effort`. Keep the two classes side by side
and resist the urge to unify their parameters: they are genuinely different
APIs, and the interface above is the abstraction.

---

## 6. The mock provider — build this first

**`AI_PROVIDER=mock` is not optional.** Without it, every browser test of an AI
feature costs money, needs a key in CI, and is non-deterministic — which in
practice means those features never get tested at all.

The mock answers from `purpose`, with no network and no cost:

```ts
class MockProvider implements Provider {
  readonly name = "mock" as const;
  readonly model = "mock";

  async complete(request: CompletionRequest): Promise<string> {
    const latest = request.messages[request.messages.length - 1]?.content ?? "";

    // A reserved token lets a test drive the out-of-credit path deliberately.
    if (latest.includes("!nocredit")) {
      throw Object.assign(new Error("You have no credits remaining."), {
        status: 429,
        code: "credit_balance_exhausted",
      });
    }

    switch (request.purpose) {
      case "marker":
        // A job whose caller parses JSON must get JSON back from the mock too.
        return JSON.stringify({ verdict: "close", comment: `Marked ${latest.slice(0, 30)}` });
      default:
        return `[mock] reply to ${latest.slice(0, 40)}`;
    }
  }
}
```

Two things make it worth its keep:

- **Answer in the shape the caller expects.** A feature that parses JSON must
  get valid JSON from the mock, or the test exercises your error path instead of
  your feature.
- **A reserved input that fails on purpose.** `!nocredit` above lets a test
  prove the out-of-credit message reaches the page — the one error the owner
  will actually hit.

**It must never be set on the deployed server.** Say so in the env template and
in the handbook, and have the start-up log print which provider is live.

---

## 7. Errors the user can act on

The page must not show a stack trace or "something went wrong". Four
distinguishable failures, each with its own message:

```ts
export type AIErrorKind = "no_credit" | "bad_key" | "rate_limited" | "upstream";

export function classifyAIError(error: unknown): AIErrorKind {
  const e = (error ?? {}) as {
    status?: number; code?: string; type?: string; message?: string;
    error?: { code?: string; type?: string; message?: string };
  };
  const code = e.code ?? e.error?.code;
  const text = `${e.message ?? ""} ${e.error?.message ?? ""}`.toLowerCase();

  // Out of credit matters most: it is the one the owner must act on, and it is
  // the one that masquerades as something else.
  if (
    code === "insufficient_quota" ||
    code === "credit_balance_exhausted" ||
    /credit balance|no credits|insufficient.quota|billing details/.test(text)
  ) {
    return "no_credit";
  }
  if (e.status === 401 || e.status === 403) return "bad_key";
  if (e.status === 429) return "rate_limited";
  return "upstream";
}
```

**Out of credit is its own case, and it does not look like one.** OpenAI reports
an empty account as a **429**, indistinguishable at a glance from rate limiting;
Anthropic reports it as a **400** whose message mentions the credit balance. If
you treat either as "try again later", the owner waits for a problem that will
never clear on its own. Name the provider in the message and link its billing
page.

Use the SDK's typed error classes rather than string-matching where you can
(`Anthropic.RateLimitError`, `Anthropic.AuthenticationError`,
`Anthropic.APIError`), most specific first. The text matching above is the
fallback for the credit case, which has no dedicated class.

---

## 8. Getting structured data back

When the app needs fields rather than prose — a verdict plus a list of
corrections, an extracted set of values — ask for JSON and validate it.

- **Say the schema in the system prompt**, field by field, and say "reply with
  JSON and nothing else".
- **Models fence JSON whatever the prompt says.** You will get ```` ```json ````
  around it sooner or later. Parse by taking the text from the first `{` to the
  last `}` rather than trusting the whole string:

  ```ts
  export function parseJson<T>(text: string): T | null {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  ```

- **Validate against a schema** (zod, per `PLAYBOOK.md`) and treat a mismatch as
  an upstream error — a 502 and a clear message — never a half-rendered page.
  A reply that does not fit the schema is a failed request, not data.
- **Two small calls beat one big one** when the jobs are different. One call to
  produce, one to assess, each answering a narrow schema, is easier to prompt,
  easier to debug and easier to mock than one call asked to do both.
- The API also supports constrained output (`output_config.format`) if you want
  the schema enforced server-side; the parse-and-validate path above works on
  every provider, which is why it is the default here.

---

## 9. Writing the prompts

- **Keep every prompt in one module**, not inline at the call sites. They are
  the part you will tune most, and they need to be diffable and testable.
- **A constraint has to be stated as a hard limit, with a self-check.** "Aim
  for simple language" is ignored. "Use only the present tense. Do not use any
  other tense. This is a hard limit — re-read your message before sending and
  simplify anything that breaks it" is obeyed. We learned this from a model
  that cheerfully produced advanced grammar at a beginner setting and then,
  asked to grade its own output, agreed it was too advanced.
- **Give each job its own role and its own system prompt.** A single
  do-everything prompt degrades every job in it. Separate calls also let you
  run the literal ones at `effort: "low"` and the judgement ones higher.
- **Unit-test the prompt builders.** Assert that the constraints you depend on
  actually appear in the generated text. A prompt weakened by a later edit then
  fails a test instead of quietly lowering quality — this catches real
  regressions and costs nothing to run.
- **Never interpolate user text into the instruction part of a system prompt.**
  Keep it in the `messages` array where it belongs, and treat anything that
  comes back as data, never as instructions.

---

## 10. Security and cost control

- **Never commit a key.** `.env`, gitignored, template in `env.example`. If one
  is ever committed, say so immediately and rotate it — a key in git history is
  compromised even after the commit is removed.
- **Never log or print a key**, not even truncated, and never echo one into a
  terminal that might get pasted into an issue.
- **Every AI call happens server-side.** The browser never holds the key and
  never talks to the provider. This is not negotiable, whatever it costs in
  round trips.
- **The client may not choose the model, the prompt, or the token limit.** Those
  are server constants. A request that can name its own model is a request that
  can spend the owner's money at the most expensive rate.
- **Gate who may use it, per account.** If sign-up is by invitation, add a
  column to the invite list saying who may use the paid feature, and check it
  on both the page and every request. Cost is a per-person decision.
- **Rate-limit the AI routes** separately and more tightly than the rest of the
  app. One stuck client in a retry loop is otherwise an unbounded bill.
- **Never call a model on page load.** Only in response to a deliberate action.
  A prefetch "to feel fast" is a charge for something nobody read.
- If the same long context goes out repeatedly, add prompt caching
  (`cache_control: { type: "ephemeral" }`) — cached input is roughly a tenth of
  the price. Put the stable part first and the varying part last, or it will not
  hit.

---

## 11. Verification

| Command | Covers |
|---|---|
| `npm run ai:check` | One real call, printing provider, model and the reply. The only script that spends money. |
| `npm test` | Provider and model resolution for every permutation of env vars, prompt builders, JSON parsing. No network. |
| `npm run test:<feature>` | The AI features end to end in a browser, **with the server running under `AI_PROVIDER=mock`**. |

`ai:check` must load `.env` itself (see the trap in section 13) and must print
which provider and model it used, so a surprising bill has an obvious first
suspect. Write it early: "the key is wrong" and "the code is wrong" are
otherwise indistinguishable.

Resolution tests are worth more than they look. `AI_PROVIDER` unset with both
keys present, set to a provider whose key is missing, set to nonsense — each
has a defined answer in section 2, and each is a way to accidentally bill the
wrong account or silently disable the feature.

---

## 12. Deployment

- **The owner puts the key on the server themselves.** You should not handle it,
  and you cannot read `.env` there. Hand them the exact line to add and the
  command to restart, and let them paste it.
- **The key is not in CI.** The server-free suites run on every push; the
  browser suites run locally against the mock. Nothing in the pipeline needs a
  real key, which is what keeps the secret in one place.
- **The start-up log prints the provider and model, never the key.** One line —
  `AI: anthropic · claude-opus-5-5` or `AI: not configured` — turns "why is the
  feature off" into a one-glance answer.
- **Changing provider or model is an env edit plus a restart**, not a deploy.
  Say so in the handbook, because it is the thing the owner will want to do
  without you.

---

## 13. Traps that cost us time

- **`.env` must load before any import reads it.** Imports are hoisted, so a
  `loadEnvFile()` call in the body of your entry point runs *after* the module
  that chose the AI provider has already read `process.env` and found nothing.
  Put the env load in its own module and import that first, above everything
  else, and leave a comment saying why. Standalone scripts must load it
  themselves. This one is genuinely baffling from the outside: the key is right
  there in the file and the app insists it is unconfigured.
- **Picking the provider at import time** makes the above worse and makes tests
  that manipulate `process.env` useless. Either accept it and load env first, or
  resolve lazily on first use — but know which you chose.
- **API billing is not a subscription.** Said twice in this file on purpose.
- **An empty account looks like rate limiting.** Section 7.
- **Models fence JSON.** Section 8.
- **A safety decline is a 200, not an exception.** Check `stop_reason` before
  reading `content`, or you return an empty string and show a blank bubble.
- **The conversation must start with a user message.** A feature where the model
  speaks first needs a hidden kickoff turn.
- **`max_tokens` truncates silently mid-sentence** and reads as the model
  trailing off. If output looks oddly cut short, check the ceiling before
  blaming the prompt.
- **A stale model ID is a 404 with a confusing message.** If a model name was in
  your training data, verify it still exists rather than trusting it, and never
  invent a date suffix.
- **Mock set in production serves nonsense cheerfully.** Nothing errors. Guard
  it with a start-up log line.

---

## Before you call the AI feature done

- [ ] `provider === null` renders a clear "not configured" state; the app boots
      and every other page works.
- [ ] `AI_PROVIDER=mock` drives the whole feature in a browser test, including
      one deliberate failure.
- [ ] Out of credit, bad key and rate limited each produce their own message,
      naming the provider.
- [ ] No key in git, in a log, in CI, or in the browser.
- [ ] The paid feature is gated per account, and its routes are rate-limited.
- [ ] `ai:check` passes against a real key and prints provider and model.
- [ ] The handbook records which provider was chosen, what it was chosen over,
      and what it costs — the owner's decision, written down.
