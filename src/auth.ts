import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

import { db } from "./db/index.js";
import { passwordResets, sessions, users, type User } from "./db/schema.js";

const SESSION_COOKIE = "ll_session";
const SESSION_DAYS = 30;

/** Wrong passwords in a row before an account locks. */
export const MAX_FAILED_LOGINS = 5;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function createSession(userId: number): string {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.insert(sessions).values({ id, userId, expiresAt }).run();
  return id;
}

export function destroySession(id: string): void {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

/** Drop expired rows so the table cannot grow without bound. */
export function pruneSessions(): void {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
}

export function userForSession(sessionId: string | undefined): User | null {
  if (!sessionId) return null;

  const row = db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .get();

  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    destroySession(sessionId);
    return null;
  }

  return row.user;
}

/**
 * Counts a wrong password and returns how many attempts remain — 0 means this
 * one locked the account. The increment is a single UPDATE, so guesses fired in
 * parallel cannot slip past the limit.
 */
export function recordFailedLogin(userId: number): number {
  const row = db
    .update(users)
    .set({ failedLogins: sql`${users.failedLogins} + 1` })
    .where(eq(users.id, userId))
    .returning({ failedLogins: users.failedLogins })
    .get();

  const failures = row?.failedLogins ?? MAX_FAILED_LOGINS;
  if (failures >= MAX_FAILED_LOGINS) {
    db.update(users)
      .set({ lockedAt: new Date().toISOString() })
      .where(and(eq(users.id, userId), isNull(users.lockedAt)))
      .run();
  }

  return Math.max(0, MAX_FAILED_LOGINS - failures);
}

/** After a successful sign-in, a password reset, or the owner unlocking it. */
export function clearFailedLogins(userId: number): void {
  db.update(users).set({ failedLogins: 0, lockedAt: null }).where(eq(users.id, userId)).run();
}

/* ------------------------------------------------------------------ */
/* Password resets                                                     */
/* ------------------------------------------------------------------ */

/** How long a reset link is good for. Long enough to find the email, short
 *  enough that an old one in a mailbox is not a standing key. */
export const RESET_MINUTES = 60;

/**
 * A reset token is **hashed with SHA-256, not argon2**, and that is deliberate
 * rather than an oversight. Argon2 is slow on purpose to make *guessable*
 * secrets expensive to attack; a 256-bit random token is not guessable, so the
 * slowness would buy nothing and cost a visible delay on every link click.
 * What matters is that the database stores a hash at all, so a copy of the
 * table cannot be used to take over an account.
 */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Issues a reset for an account, cancelling any outstanding ones. Returns the
 * plain token, which exists only here and in the email — it is never stored
 * and cannot be recovered afterwards.
 */
export function createPasswordReset(userId: number): { token: string; expiresAt: Date } {
  // One live link per account: asking again should invalidate the last one,
  // or a forwarded old email stays usable.
  db.update(passwordResets)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)))
    .run();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);
  db.insert(passwordResets)
    .values({ userId, tokenHash: hashToken(token), expiresAt: expiresAt.toISOString() })
    .run();

  return { token, expiresAt };
}

export type ResetLookup =
  | { ok: true; id: number; userId: number }
  | { ok: false; reason: "unknown" | "used" | "expired" };

/**
 * Looks a token up without consuming it, so the form can be shown before the
 * new password is typed. "Used" and "expired" are told apart from "unknown"
 * on purpose: pressing back onto a spent link is common and harmless, and
 * "that link has already been used" is a far less alarming thing to read than
 * "no such link". None of the three reveals whether an account exists.
 */
export function findPasswordReset(token: string): ResetLookup {
  if (!token) return { ok: false, reason: "unknown" };
  const row = db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, hashToken(token)))
    .get();

  if (!row) return { ok: false, reason: "unknown" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (new Date(row.expiresAt).getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, id: row.id, userId: row.userId };
}

/**
 * Spends a reset. Single-use is enforced by the `usedAt IS NULL` in the WHERE,
 * so two requests arriving together cannot both succeed — the second updates
 * no rows and is told so.
 */
export function usePasswordReset(id: number): boolean {
  const row = db
    .update(passwordResets)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(passwordResets.id, id), isNull(passwordResets.usedAt)))
    .returning({ id: passwordResets.id })
    .get();
  return Boolean(row);
}

/** Drops spent and expired resets. Called alongside session pruning. */
export function prunePasswordResets(): void {
  db.delete(passwordResets).where(lt(passwordResets.expiresAt, new Date().toISOString())).run();
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 86_400,
    // Secure whenever the visitor came in over HTTPS — on the server that is
    // Caddy saying so, which server.ts trusts. Plain HTTP on the home Wi-Fi
    // still gets a working cookie, where a hard-coded `true` would lock the
    // phone out.
    secure: request.protocol === "https",
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function sessionIdFrom(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

export { SESSION_COOKIE };
