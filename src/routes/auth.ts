import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { aiAllowedCount, allowedEmails, allowlistPath, mayRegister } from "../allowlist.js";
import {
  MAX_FAILED_LOGINS,
  clearFailedLogins,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  recordFailedLogin,
  sessionIdFrom,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { createLimiter, isLoopback } from "../rate-limit.js";
import { authLayout, esc } from "../views/layout.js";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Per-address limits, on top of the per-account lockout. The lockout stops
 * guessing one account's password; these stop one address trying many
 * accounts, and stop a flood of sign-ins pinning the CPU — argon2 is slow on
 * purpose, so every attempt costs real work.
 */
const loginLimiter = createLimiter({ max: 10, windowMs: 15 * 60_000 });
const registerLimiter = createLimiter({ max: 5, windowMs: 60 * 60_000 });

function overLimit(limiter: ReturnType<typeof createLimiter>, request: FastifyRequest): boolean {
  return !isLoopback(request.ip) && !limiter.allow(request.ip);
}

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
          : "Sign-up is by invitation — use the email address you were invited with."
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
            ? `Invited? <a href="/register">Create your account</a>`
            : `Already have an account? <a href="/login">Sign in</a>`
        }
      </div>`,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const invited = allowedEmails().size;
  if (invited === 0) {
    app.log.warn(`Nobody can sign up: ${allowlistPath()} is missing or lists no addresses.`);
  } else {
    app.log.info(
      `Sign-up is open to ${invited} invited address${invited === 1 ? "" : "es"}, ${aiAllowedCount()} with conversation (${allowlistPath()}).`,
    );
  }

  app.get("/login", async (request, reply) => {
    reply.type("text/html").send(form({ mode: "login" }));
  });

  app.get("/register", async (request, reply) => {
    reply.type("text/html").send(form({ mode: "register" }));
  });

  app.post("/register", async (request, reply) => {
    if (overLimit(registerLimiter, request)) {
      return reply.code(429).type("text/html").send(
        form({
          mode: "register",
          error: "Too many sign-up attempts from your connection. Try again in an hour.",
        }),
      );
    }

    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Check your details.";
      return reply
        .type("text/html")
        .send(form({ mode: "register", error: message }));
    }

    const { email, password } = parsed.data;

    // Checked first, so someone not invited learns nothing about which
    // addresses already have accounts.
    if (!mayRegister(email)) {
      return reply.type("text/html").send(
        form({
          mode: "register",
          email,
          error: "Sign-up is by invitation, and this email address is not on the list.",
        }),
      );
    }

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

    setSessionCookie(request, reply, createSession(created.id));
    return reply.redirect("/");
  });

  app.post("/login", async (request, reply) => {
    if (overLimit(loginLimiter, request)) {
      return reply.code(429).type("text/html").send(
        form({
          mode: "login",
          error: "Too many sign-in attempts from your connection. Wait 15 minutes and try again.",
        }),
      );
    }

    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .type("text/html")
        .send(form({ mode: "login", error: "Enter your email and password." }));
    }

    const { email, password } = parsed.data;
    const user = db.select().from(users).where(eq(users.email, email)).get();

    const refuse = (error: string) =>
      reply.type("text/html").send(form({ mode: "login", email, error }));
    const locked = `This account is locked after ${MAX_FAILED_LOGINS} incorrect passwords. Ask the site owner to unlock it.`;

    if (!user) {
      // Spend comparable time so a missing user is not detectably faster.
      await hashPassword(password);
      return refuse("Email or password is incorrect.");
    }

    // Locked stays locked even for the right password; otherwise the lock would
    // only slow a guesser down rather than stop them.
    if (user.lockedAt) return refuse(locked);

    if (!(await verifyPassword(user.passwordHash, password))) {
      const left = recordFailedLogin(user.id);
      if (left === 0) return refuse(locked);
      // Saying how many tries remain does reveal that the account exists. With
      // sign-up by invitation that gives little away, and the warning is what
      // stops the owner locking themselves out.
      return refuse(
        `Email or password is incorrect. ${left} attempt${left === 1 ? "" : "s"} left before this account is locked.`,
      );
    }

    if (user.failedLogins > 0) clearFailedLogins(user.id);
    setSessionCookie(request, reply, createSession(user.id));
    return reply.redirect("/");
  });

  app.post("/logout", async (request, reply) => {
    const sessionId = sessionIdFrom(request);
    if (sessionId) destroySession(sessionId);
    clearSessionCookie(reply);
    return reply.redirect("/login");
  });
}
