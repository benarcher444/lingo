import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  sessionIdFrom,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { authLayout, esc } from "../views/layout.js";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

function form(opts: {
  mode: "login" | "register";
  error?: string;
  email?: string;
}): string {
  const isLogin = opts.mode === "login";

  return authLayout({
    title: isLogin ? "Sign in" : "Create account",
    body: `
      <h1>${isLogin ? "Welcome back" : "Create your account"}</h1>
      <p class="sub">${
        isLogin
          ? "Sign in to pick up where you left off."
          : "Your vocabulary and progress stay private to your account."
      }</p>
      ${opts.error ? `<div class="alert alert-error" style="margin-bottom:14px">${esc(opts.error)}</div>` : ""}
      <form class="auth-form" method="post" action="${isLogin ? "/login" : "/register"}">
        <div class="field">
          <label for="email">Email</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email"
                 required value="${esc(opts.email ?? "")}" placeholder="you@example.com">
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input class="input" id="password" name="password" type="password"
                 autocomplete="${isLogin ? "current-password" : "new-password"}"
                 required minlength="8" placeholder="${isLogin ? "Your password" : "At least 8 characters"}">
        </div>
        <button class="btn btn-primary btn-lg" type="submit">${isLogin ? "Sign in" : "Create account"}</button>
      </form>
      <div class="auth-foot">
        ${
          isLogin
            ? `No account yet? <a href="/register">Create one</a>`
            : `Already have an account? <a href="/login">Sign in</a>`
        }
      </div>`,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/login", async (request, reply) => {
    reply.type("text/html").send(form({ mode: "login" }));
  });

  app.get("/register", async (request, reply) => {
    reply.type("text/html").send(form({ mode: "register" }));
  });

  app.post("/register", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Check your details.";
      return reply
        .type("text/html")
        .send(form({ mode: "register", error: message }));
    }

    const { email, password } = parsed.data;

    const existing = db.select().from(users).where(eq(users.email, email)).get();
    if (existing) {
      return reply.type("text/html").send(
        form({
          mode: "register",
          email,
          error: "That email is already registered. Try signing in instead.",
        }),
      );
    }

    const passwordHash = await hashPassword(password);
    const created = db.insert(users).values({ email, passwordHash }).returning().get();

    setSessionCookie(reply, createSession(created.id));
    return reply.redirect("/");
  });

  app.post("/login", async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .type("text/html")
        .send(form({ mode: "login", error: "Enter your email and password." }));
    }

    const { email, password } = parsed.data;
    const user = db.select().from(users).where(eq(users.email, email)).get();

    // Same message either way, so the form cannot be used to discover which
    // email addresses have accounts.
    const invalid = () =>
      reply
        .type("text/html")
        .send(form({ mode: "login", email, error: "Email or password is incorrect." }));

    if (!user) {
      // Spend comparable time so a missing user is not detectably faster.
      await hashPassword(password);
      return invalid();
    }

    if (!(await verifyPassword(user.passwordHash, password))) return invalid();

    setSessionCookie(reply, createSession(user.id));
    return reply.redirect("/");
  });

  app.post("/logout", async (request, reply) => {
    const sessionId = sessionIdFrom(request);
    if (sessionId) destroySession(sessionId);
    clearSessionCookie(reply);
    return reply.redirect("/login");
  });
}
