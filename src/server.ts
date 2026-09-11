// First, before any module reads process.env — see env.ts.
import "./env.js";

import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { provider, providerLabel } from "./ai.js";
import { pruneSessions } from "./auth.js";
import { loadContext, rememberLanguage, requireContext } from "./context.js";
import { eq } from "drizzle-orm";

import { databasePath, db } from "./db/index.js";
import { users } from "./db/schema.js";
import { runMigrations } from "./db/migrate.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { practiceRoutes } from "./routes/practice.js";
import { progressRoutes } from "./routes/progress.js";
import { vocabRoutes } from "./routes/vocab.js";
import { loadScoredWords } from "./stats.js";
import { NO_AUTOFILL, pageHead } from "./views/components.js";
import { esc, icons, layout, themeSwitch } from "./views/layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");

const PORT = Number(process.env.PORT ?? 3000);
// 0.0.0.0 so other devices on the home Wi-Fi can reach it. On a public server
// set HOST=127.0.0.1, so only the HTTPS proxy in front of it can.
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  // Believe X-Forwarded-For and -Proto only from a proxy on this machine (Caddy
  // on the server). Then request.ip is the visitor, for rate limiting, and
  // request.protocol is https, for the Secure cookie. The same headers from
  // anyone else are ignored.
  trustProxy: "127.0.0.1,::1",
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
  if (owned) rememberLanguage(request, reply, languageId);

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

/**
 * Auto / Light / Dark, saved to the account so one choice holds on every
 * device. Sends you back to the page the switch was on — only ever a path on
 * this site, never wherever a Referer claims.
 */
app.post("/preferences/theme", async (request, reply) => {
  const ctx = loadContext(request, "");
  if (!ctx) return reply.redirect("/login");

  const theme = (request.body as Record<string, unknown> | undefined)?.["theme"];
  if (theme === "auto" || theme === "light" || theme === "dark") {
    db.update(users).set({ theme }).where(eq(users.id, ctx.user.id)).run();
  }

  let back = "/";
  try {
    const referer = new URL(request.headers.referer ?? "");
    if (referer.host === request.headers.host) back = referer.pathname + referer.search;
  } catch {
    // No usable Referer: the home page will do.
  }
  return reply.redirect(back);
});

/* ------------------------------------------------------------------
   Settings
   ------------------------------------------------------------------ */

app.get("/settings", async (request, reply) => {
  const ctx = requireContext(request, reply, "settings");
  if (!ctx) return;

  const aiConfigured = provider !== null;

  const languageChoices = ctx.languages
    .map((l) => {
      const current = l.id === ctx.currentLanguage?.id;
      return `<a class="lang-choice" href="/switch-language?language=${l.id}&return=settings"${
        current ? ' aria-current="true"' : ""
      }><span>${esc(l.name)}</span>${
        current ? '<span class="pill pill-accent">Current</span>' : '<span class="hint">Switch</span>'
      }</a>`;
    })
    .join("");

  // On a phone this page is the menu: the Settings tab is the only way to the
  // account, the languages and the theme.
  const body = `
    ${pageHead({ title: "Settings", sub: "Your account, your languages, and how Lingo looks." })}
    <div class="stack">
      <div class="card">
        <div class="card-head"><div><h2>Account</h2></div></div>
        <div class="card-body stack-sm">
          <div class="row"><strong style="width:110px">Signed in as</strong><span>${esc(ctx.user.email)}</span></div>
          <form method="post" action="/logout">
            <button class="btn" type="submit">${icons.logout}Sign out or switch account</button>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Language</h2>
          <div class="sub">Each language has its own words and progress.</div></div></div>
        <div class="card-body stack">
          ${ctx.languages.length > 0 ? `<div class="lang-list">${languageChoices}</div>` : `<p class="hint">No languages yet.</p>`}
          <form method="post" action="/languages" class="row" autocomplete="off">
            <input class="input" name="name" placeholder="Add a language, e.g. Italian" required style="flex:1 1 200px" ${NO_AUTOFILL}>
            <button class="btn btn-primary" type="submit">${icons.plus}Create language</button>
          </form>
          <div class="hint">A new language starts with a set of categories (nouns, verbs and so on) that you can change.</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Appearance</h2>
          <div class="sub">Saved to your account, so it applies on every device.</div></div></div>
        <div class="card-body">${themeSwitch(ctx.user.theme)}</div>
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
            <span class="hint">Uses your browser's voices. Chrome's French and Spanish voices need an internet connection.</span></div>
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
  await app.listen({
    port: PORT,
    host: HOST,
    // Fastify's default line reads "listening at http://0.0.0.0:3000", which
    // looks like an address you can open but is only the bind address. Replace
    // it with the addresses that actually work.
    listenTextResolver: () => `Lingo is running`,
  });

  app.log.info(`Database: ${databasePath}`);
  app.log.info(`On this machine:  http://localhost:${PORT}`);

  // Bound to loopback, as on the hosted server behind Caddy, the LAN addresses
  // would be wrong: nothing but the proxy can reach the app.
  if (["127.0.0.1", "::1", "localhost"].includes(HOST)) {
    app.log.info("Listening on this machine only: visitors arrive through the HTTPS proxy.");
  } else {
    const lan = lanAddresses();
    for (const address of lan) {
      app.log.info(`On your phone:    http://${address}:${PORT}   (same Wi-Fi)`);
    }
    if (lan.length === 0) {
      app.log.warn("No network address found — only this machine can reach it.");
    }
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
