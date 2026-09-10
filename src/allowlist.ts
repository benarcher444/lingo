/**
 * Who may create an account, and who may use the AI tutor: allowed_emails.csv
 * at the project root (or ALLOWLIST_PATH).
 *
 *   email,ai
 *   you@example.com,yes
 *   friend@example.com,no
 *
 * The "ai" column says who may use Conversation, which costs money to run.
 * Blank, "no", or no such column means no. Blank lines and lines starting with
 * # are skipped. Without a header row, the first column is the address and the
 * second the AI flag.
 *
 * Read on every request rather than cached, so a change is an edit to the file
 * with no restart. A missing or empty file means nobody can sign up and nobody
 * gets the AI — failing closed, because open access on a public server would
 * spend the AI key on strangers.
 *
 * The file is gitignored: the repository is public, and these are people's
 * email addresses.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Resolved when asked, not at import, so a value from .env is honoured. */
export function allowlistPath(): string {
  return resolve(process.env.ALLOWLIST_PATH ?? "allowed_emails.csv");
}

interface Invite {
  email: string;
  ai: boolean;
}

function cell(value: string | undefined): string {
  return (value ?? "").trim().replace(/^"(.*)"$/, "$1").trim();
}

function readInvites(): Invite[] {
  let text: string;
  try {
    text = readFileSync(allowlistPath(), "utf8");
  } catch {
    return [];
  }

  // Excel saves CSV with a byte-order mark, which would glue itself to the
  // header — or to the first address, if there is no header.
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"));

  let emailColumn = 0;
  let aiColumn = 1;
  const header = (lines[0] ?? "").split(",").map((c) => cell(c).toLowerCase());
  if (header.includes("email")) {
    emailColumn = header.indexOf("email");
    aiColumn = header.indexOf("ai"); // -1: no column, so nobody has the AI
    lines.shift();
  }

  return lines
    .map((line) => {
      const columns = line.split(",");
      return {
        email: cell(columns[emailColumn]).toLowerCase(),
        ai: aiColumn >= 0 && /^(y|yes|true|1)$/i.test(cell(columns[aiColumn])),
      };
    })
    .filter((invite) => invite.email);
}

export function allowedEmails(): Set<string> {
  return new Set(readInvites().map((invite) => invite.email));
}

export function mayRegister(email: string): boolean {
  return allowedEmails().has(email.trim().toLowerCase());
}

/** Whether this account may use Conversation, the part that costs money. */
export function mayUseAI(email: string): boolean {
  const address = email.trim().toLowerCase();
  return readInvites().some((invite) => invite.email === address && invite.ai);
}

export function aiAllowedCount(): number {
  return readInvites().filter((invite) => invite.ai).length;
}
