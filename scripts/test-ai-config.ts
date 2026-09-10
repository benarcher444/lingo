/**
 * Checks that AI_PROVIDER / AI_MODEL select the right backend, without calling
 * any API. Each case runs in a child process because the provider is resolved
 * once at import time.
 *
 *   npx tsx scripts/test-ai-config.ts
 */

import { execFileSync } from "node:child_process";

interface Case {
  name: string;
  env: Record<string, string>;
  expect: string;
}

const CASES: Case[] = [
  {
    name: "AI_PROVIDER=openai",
    env: { AI_PROVIDER: "openai", OPENAI_API_KEY: "test" },
    expect: "OpenAI · gpt-4o-mini",
  },
  {
    name: "AI_PROVIDER=anthropic",
    env: { AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test" },
    expect: "Anthropic · claude-opus-5",
  },
  {
    name: "AI_MODEL overrides the default",
    env: { AI_PROVIDER: "openai", OPENAI_API_KEY: "test", AI_MODEL: "gpt-4o" },
    expect: "OpenAI · gpt-4o",
  },
  {
    name: "unset falls back to the key present",
    env: { OPENAI_API_KEY: "test" },
    expect: "OpenAI · gpt-4o-mini",
  },
  {
    name: "unset prefers Anthropic when both keys exist",
    env: { OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" },
    expect: "Anthropic · claude-opus-5",
  },
  {
    name: "AI_PROVIDER=none disables it even with a key",
    env: { AI_PROVIDER: "none", OPENAI_API_KEY: "test" },
    expect: "Not configured",
  },
  {
    name: "provider set but key missing is off, not broken",
    env: { AI_PROVIDER: "openai" },
    expect: "Not configured",
  },
  {
    name: "nothing set at all",
    env: {},
    expect: "Not configured",
  },
  {
    name: "an unrecognised provider name falls back safely",
    env: { AI_PROVIDER: "gemini", OPENAI_API_KEY: "test" },
    expect: "OpenAI · gpt-4o-mini",
  },
];

let failures = 0;

console.log("\nAI provider configuration\n");

for (const testCase of CASES) {
  // A clean env per case: strip anything inherited (including a real .env
  // loaded into this process) so the case controls exactly what is set.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["AI_PROVIDER"];
  delete env["AI_MODEL"];
  delete env["OPENAI_API_KEY"];
  delete env["ANTHROPIC_API_KEY"];
  Object.assign(env, testCase.env, { LL_SKIP_ENV_FILE: "1" });

  // process.execPath + the tsx binary directly, rather than `npx ... shell:true`,
  // which Node deprecates because the arguments are concatenated unescaped.
  const output = execFileSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/print-provider.ts"],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

  const actual = output.split("\n").pop()?.trim() ?? "";
  const ok = actual === testCase.expect;
  if (!ok) failures += 1;

  console.log(`  ${ok ? "ok  " : "FAIL"} ${testCase.name}`);
  if (!ok) console.log(`         got "${actual}", want "${testCase.expect}"`);
}

console.log(`\n${failures === 0 ? "All configurations resolve correctly." : `${failures} failed.`}\n`);
if (failures > 0) process.exit(1);
