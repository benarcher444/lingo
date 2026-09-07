/**
 * Confirms the configured AI provider is reachable and answering, without
 * opening the app.
 *
 *   npm run ai:check
 *
 * Sends one very short request, so it costs a fraction of a penny.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env — fall back to the shell environment.
}

const { provider, providerLabel } = await import("../src/ai.js");

console.log(`\nProvider: ${providerLabel()}`);

if (!provider) {
  console.log(`
Not configured. In .env set:

  AI_PROVIDER=openai            (or anthropic)
  OPENAI_API_KEY=sk-...         (or ANTHROPIC_API_KEY=sk-ant-...)

Then run this again.
`);
  process.exit(1);
}

console.log("Sending a test message…\n");

try {
  const reply = await provider.complete({
    system:
      "You are a French tutor. Reply in French with one short friendly sentence. No English.",
    messages: [{ role: "user", content: "Bonjour, comment ça va ?" }],
    effort: "low",
    maxTokens: 100,
  });

  if (!reply.trim()) {
    console.log("Connected, but the reply came back empty. Check the model name.\n");
    process.exit(1);
  }

  console.log(`  ${reply}\n`);
  console.log("Working. Conversation practice is live.\n");
} catch (error) {
  const status = (error as { status?: number })?.status;
  const message = (error as Error)?.message ?? String(error);

  console.log("Failed.\n");

  if (status === 401 || status === 403) {
    console.log("  The API key was rejected. Check it is current and has credit.\n");
  } else if (status === 404) {
    console.log(`  Model not found — check AI_MODEL is valid for this provider.\n`);
  } else if (status === 429) {
    console.log("  Rate limited or out of quota. Check your account balance.\n");
  } else {
    console.log(`  ${message.split("\n")[0]}\n`);
  }

  process.exit(1);
}
