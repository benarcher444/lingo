import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { aiAllowedCount, allowedEmails, allowlistPath, mayRegister } from "../allowlist.js";
import {
  MAX_FAILED_LOGINS,
  RESET_MINUTES,
  clearFailedLogins,
  clearSessionCookie,
  createPasswordReset,
  createSession,
  destroySession,
  findPasswordReset,
  hashPassword,
  recordFailedLogin,
  sessionIdFrom,
  setSessionCookie,
  usePasswordReset,
  verifyPassword,
} from "../auth.js";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import { EmailFailed, appUrl, emailProvider, sendMail } from "../email.js";
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
/**
 * Resets are rarer than sign-ins and each one sends an email, so the limit is
 * tighter: it also stops this being used to post mail at somebody.
 */
const resetLimiter = createLimiter({ max: 5, windowMs: 60 * 60_000 });

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
            ? `<a href="/forgot">Forgotten your password?</a><br>Invited? <a href="/register">Create your account</a>`
            : `Already have an account? <a href="/login">Sign in</a>`
        }
      </div>`,
  });
}

/** The "enter your address" step. */
function forgotForm(opts: { error?: string; email?: string }): string {
  return authLayout({
    title: "Reset your password",
    body: `
      <h1>Reset your password</h1>
      <p class="sub">We will email you a link to choose a new one.</p>
      ${opts.error ? `<div class="alert alert-error" style="margin-bottom:14px">${esc(opts.error)}</div>` : ""}
      <form class="auth-form" method="post" action="/forgot">
        <div class="field">
          <label for="email">Email</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email"
                 required value="${esc(opts.email ?? "")}" placeholder="you@example.com">
        </div>
        <button class="btn btn-primary btn-lg" type="submit">Email me a link</button>
      </form>
      <div class="auth-foot"><a href="/login">Back to sign in</a></div>`,
  });
}

/** The "choose a new one" step. The token rides in a hidden field rather than
 *  the form action, so it stays out of anything that logs a POST path. */
function resetForm(opts: { token: string; error?: string }): string {
  return authLayout({
    title: "Choose a new password",
    body: `
      <h1>Choose a new password</h1>
      <p class="sub">This link works once. Other devices will be signed out.</p>
      ${opts.error ? `<div class="alert alert-error" style="margin-bottom:14px">${esc(opts.error)}</div>` : ""}
      <form class="auth-form" method="post" action="/reset">
        <input type="hidden" name="token" value="${esc(opts.token)}">
        <div class="field">
          <label for="password">New password</label>
          <input class="input" id="password" name="password" type="password"
                 autocomplete="new-password" required minlength="8"
                 placeholder="At least 8 characters">
        </div>
        <div class="field">
          <label for="confirm">Repeat it</label>
          <input class="input" id="confirm" name="confirm" type="password"
                 autocomplete="new-password" required minlength="8"
                 placeholder="The same again">
        </div>
        <button class="btn btn-primary btn-lg" type="submit">Set password</button>
      </form>
      <div class="auth-foot"><a href="/login">Back to sign in</a></div>`,
  });
}

/** One sentence and a way onward. */
function notice(opts: { title: string; body: string; action?: { href: string; label: string } }): string {
  return authLayout({
    title: opts.title,
    body: `
      <h1>${esc(opts.title)}</h1>
      <p class="sub">${opts.body}</p>
      <div class="auth-foot">${
        opts.action
          ? `<a href="${esc(opts.action.href)}">${esc(opts.action.label)}</a>`
          : `<a href="/login">Back to sign in</a>`
      }</div>`,
  });
}

/**
 * A link that cannot be used. The three reasons are told apart because they
 * mean different things to the person holding it — pressing back onto a spent
 * link is common and harmless — and none of them says whether an account
 * exists.
 */
function deadLink(reason: "unknown" | "used" | "expired"): string {
  const body =
    reason === "used"
      ? "That link has already been used. Ask for another if you still need one."
      : reason === "expired"
        ? `That link was only good for ${RESET_MINUTES} minutes. Ask for a fresh one.`
        : "That link is not one we recognise. It may have been replaced by a newer request.";
  return notice({
    title: "This link cannot be used",
    body,
    action: { href: "/forgot", label: "Send a new link" },
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
    // A reset both sets the password and clears the lock, so the way out is
    // no longer "find somebody with a shell on the server". Plain prose, not a
    // link: `form` escapes this, and the sign-in page carries the link anyway.
    const locked = `This account is locked after ${MAX_FAILED_LOGINS} incorrect passwords. Use "Forgotten your password?" below to unlock it.`;

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

  /* ----------------------------------------------------------------
     Forgotten passwords

     Until this existed a password could only be replaced by somebody with a
     shell on the server, and the five-wrong-passwords lock needed the same.
     That was tolerable while the server held one person's account. It no
     longer does, and "ask the owner" is not a password reset.
     ---------------------------------------------------------------- */

  app.get("/forgot", async (request, reply) => {
    reply.type("text/html").send(forgotForm({}));
  });

  app.post("/forgot", async (request, reply) => {
    if (overLimit(resetLimiter, request)) {
      return reply.code(429).type("text/html").send(
        forgotForm({
          error: "Too many reset requests from your connection. Wait an hour and try again.",
        }),
      );
    }

    const parsed = z
      .object({ email: z.string().trim().toLowerCase().email() })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply
        .type("text/html")
        .send(forgotForm({ error: "Enter the email address for your account." }));
    }

    const email = parsed.data.email;
    const user = db.select().from(users).where(eq(users.email, email)).get();

    if (user) {
      const { token } = createPasswordReset(user.id);
      const origin = `${request.protocol}://${request.host}`;
      const link = `${appUrl(origin)}/reset/${token}`;
      // Deliberately not awaited. Sending over SMTP takes a visible moment and
      // doing nothing does not, so awaiting it would make "this address has an
      // account" measurable with a stopwatch — undoing the identical wording
      // below. Errors are caught inside, and the server is long-lived, so
      // nothing is lost by letting it finish after the response.
      void (async () => {
        try {
          const sent = await sendMail({
            to: email,
            subject: "Reset your Lingo password",
            text: [
              "Somebody asked to reset the password for your Lingo account.",
              "",
              "Open this link to choose a new one:",
              link,
              "",
              `The link works once and expires in ${RESET_MINUTES} minutes.`,
              "If this was not you, ignore this email — nothing has changed, and",
              "the link stops working as soon as a newer one is requested.",
            ].join("\n"),
          });
          request.log.info(`Password reset for ${email}: ${sent.detail}`);
        } catch (error) {
          // The visitor is told the same thing either way, so a broken mail
          // server does not become a way to ask whether an account exists. The
          // operator finds out from the log.
          const why = error instanceof EmailFailed ? error.message : String(error);
          request.log.error(`Password reset email for ${email} failed: ${why}`);
        }
      })();
    }

    // The same answer whether or not the address has an account. The sign-in
    // form deliberately reveals account existence through the attempts-left
    // count, which stops the owner locking themselves out; a page anybody can
    // post to is a different proposition and has no such excuse.
    return reply.type("text/html").send(
      notice({
        title: "Check your email",
        body:
          `If ${esc(email)} has an account, a link to choose a new password is on its way. ` +
          `It works once and expires in ${RESET_MINUTES} minutes.` +
          (emailProvider() === "console"
            ? " <strong>This installation is not configured to send mail</strong>, so the link was written to the server log instead."
            : ""),
      }),
    );
  });

  app.get("/reset/:token", async (request, reply) => {
    const token = (request.params as { token: string }).token;
    const found = findPasswordReset(token);
    if (!found.ok) return reply.type("text/html").send(deadLink(found.reason));
    return reply.type("text/html").send(resetForm({ token }));
  });

  app.post("/reset", async (request, reply) => {
    const parsed = z
      .object({
        token: z.string().min(1),
        password: z.string().min(8, "Password must be at least 8 characters."),
        confirm: z.string(),
      })
      .safeParse(request.body);

    if (!parsed.success) {
      const token = (request.body as { token?: string })?.token ?? "";
      return reply.type("text/html").send(
        resetForm({ token, error: "Choose a password of at least 8 characters." }),
      );
    }

    const { token, password, confirm } = parsed.data;
    if (password !== confirm) {
      return reply
        .type("text/html")
        .send(resetForm({ token, error: "Those two passwords do not match." }));
    }

    const found = findPasswordReset(token);
    if (!found.ok) return reply.type("text/html").send(deadLink(found.reason));

    // Spend the token before changing anything: the UPDATE only matches an
    // unused row, so two requests racing cannot both get through.
    if (!usePasswordReset(found.id)) {
      return reply.type("text/html").send(deadLink("used"));
    }

    db.update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, found.userId))
      .run();

    // Everything the old password could reach is now closed: other sessions
    // are signed out, as `set-password.ts` has always done, and the lock that
    // may have sent them here in the first place is cleared.
    db.delete(sessions).where(eq(sessions.userId, found.userId)).run();
    clearFailedLogins(found.userId);

    request.log.info(`Password reset completed for user ${found.userId}.`);

    return reply.type("text/html").send(
      notice({
        title: "Password changed",
        body: "You can sign in with your new password. Any other devices were signed out.",
        action: { href: "/login", label: "Sign in" },
      }),
    );
  });

  app.post("/logout", async (request, reply) => {
    const sessionId = sessionIdFrom(request);
    if (sessionId) destroySession(sessionId);
    clearSessionCookie(reply);
    return reply.redirect("/login");
  });
}
