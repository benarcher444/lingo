import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

import { db } from "./db/index.js";
import { sessions, users, type User } from "./db/schema.js";

const SESSION_COOKIE = "ll_session";
const SESSION_DAYS = 30;

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

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 86_400,
    // Left off deliberately: the Pi will serve plain HTTP on the LAN before it
    // gets a certificate. Turn on once there is one.
    secure: false,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function sessionIdFrom(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}

export { SESSION_COOKIE };
