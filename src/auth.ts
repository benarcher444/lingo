import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

import { db } from "./db/index.js";
import { sessions, users, type User } from "./db/schema.js";

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
