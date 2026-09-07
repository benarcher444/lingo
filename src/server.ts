import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { provider, providerLabel } from "./ai.js";
import { pruneSessions } from "./auth.js";
import { loadContext, requireContext } from "./context.js";
import { databasePath } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { practiceRoutes } from "./routes/practice.js";
import { progressRoutes } from "./routes/progress.js";
import { vocabRoutes } from "./routes/vocab.js";
import { loadScoredWords } from "./stats.js";
import { pageHead } from "./views/components.js";
import { esc, icons, layout } from "./views/layout.js";

// Load .env before anything reads process.env (Node 20.6+ builtin, no dependency).
try {
  process.loadEnvFile();
} catch {
  // No .env file — environment variables come from the shell.
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");

const PORT = Number(process.env.PORT ?? 3000);
// 0.0.0.0 so the Pi is reachable from other devices on the LAN, not just itself.
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
  },
});

await app.register(cookie);
await app.register(formbody);
await app.register(fastifyStatic, {
  root: join(projectRoot, "public"),
  prefix: "/static/",
});

await app.register(authRoutes);
await app.register(chatRoutes);
await app.register(vocabRoutes);
await app.register(practiceRoutes);
await app.register(progressRoutes);

/* ------------------------------------------------------------------
   Home
   ------------------------------------------------------------------ */

app.get("/", async (request, reply) => {
  const ctx = loadContext(request, "written");
  if (!ctx) return reply.redirect("/login");

  if (!ctx.currentLanguage) return reply.redirect("/vocab");

  const hasWords = loadScoredWords(ctx.currentLanguage.id, "written").length > 0;
  return reply.redirect(
    hasWords
      ? `/practice/written?language=${ctx.currentLanguage.id}`
      : `/vocab?language=${ctx.currentLanguage.id}`,
  );
});

/** Language switcher in the sidebar posts here and bounces back where it came from. */
app.get("/switch-language", async (request, reply) => {
  const ctx = loadContext(request, "vocab");
  if (!ctx) return reply.redirect("/login");

  const query = request.query as Record<string, string | undefined>;
  const languageId = Number(query["language"]);
  const owned = ctx.languages.some((l) => l.id === languageId);
  const target = owned ? languageId : ctx.currentLanguage?.id;

  const returnTo = query["return"] ?? "vocab";
  const routes: Record<string, string> = {
    written: "/practice/written",
    audio: "/practice/audio",
    chat: "/practice/chat",
    vocab: "/vocab",
    progress: "/progress",
    settings: "/settings",
  };

  const path = routes[returnTo] ?? "/vocab";
  return reply.redirect(target ? `${path}?language=${target}` : path);
});

/* ------------------------------------------------------------------
   Settings
   ------------------------------------------------------------------ */

app.get("/settings", async (request, reply) => {
  const ctx = requireContext(request, reply, "settings");
  if (!ctx) return;

  const aiConfigured = provider !== null;

  const body = `
    ${pageHead({ title: "Settings", sub: "Your account and this installation." })}
    <div class="stack">
      <div class="card">
        <div class="card-head"><div><h2>Account</h2></div></div>
        <div class="card-body stack-sm">
          <div class="row"><strong style="width:150px">Email</strong><span>${esc(ctx.user.email)}</span></div>
          <div class="row"><strong style="width:150px">Languages</strong>
            <span>${ctx.languages.length > 0 ? ctx.languages.map((l) => esc(l.name)).join(", ") : "none yet"}</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Add a language</h2>
          <div class="sub">A starter set of categories is created with it.</div></div></div>
        <div class="card-body">
          <form method="post" action="/languages" class="row">
            <input class="input" name="name" placeholder="Spanish" required style="width:210px">
            <button class="btn btn-primary" type="submit">${icons.plus}Create language</button>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>This installation</h2></div></div>
        <div class="card-body stack-sm">
          <div class="row"><strong style="width:150px">Database</strong>
            <span class="hint">${esc(databasePath)}</span></div>
          <div class="row"><strong style="width:150px">Conversation</strong>
            <span>${
              aiConfigured
                ? `<span class="pill pill-learnt">Connected</span> <span class="hint">${esc(providerLabel())}</span>`
                : `<span class="pill pill-plain">Not configured</span>
                   <span class="hint">Set <code>AI_PROVIDER</code> (openai or anthropic) and its API key in <code>.env</code>, then restart.</span>`
            }</span></div>
          <div class="row"><strong style="width:150px">Speech</strong>
            <span class="hint">Uses your browser's built-in voices — no internet needed.</span></div>
        </div>
      </div>
    </div>`;

  return reply.type("text/html").send(layout(ctx, { title: "Settings", body }));
});

/* ------------------------------------------------------------------
   Errors
   ------------------------------------------------------------------ */

app.setNotFoundHandler(async (request, reply) => {
  const ctx = loadContext(request, "");
  const message = `<div class="card"><div class="empty">
      <div class="empty-icon">${icons.globe}</div>
      <h2>Page not found</h2>
      <p>That link does not lead anywhere.</p>
      <a class="btn btn-primary" href="/">Back to practice</a>
    </div></div>`;

  reply.code(404).type("text/html");

  return ctx
    ? reply.send(layout(ctx, { title: "Not found", body: message }))
    : reply.redirect("/login");
});

/* ------------------------------------------------------------------
   Start
   ------------------------------------------------------------------ */

runMigrations();
pruneSessions();

/**
 * The machine's LAN addresses, so the startup log can tell you what to type on
 * your phone. The IP changes whenever you move between networks, which makes a
 * hard-coded one useless.
 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net?.family === "IPv4" && !net.internal)
    .map((net) => net!.address);
}

try {
  await app.listen({ port: PORT, host: HOST });

  app.log.info(`Database: ${databasePath}`);
  app.log.info(`On this machine:  http://localhost:${PORT}`);

  for (const address of lanAddresses()) {
    app.log.info(`On your network:  http://${address}:${PORT}`);
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
