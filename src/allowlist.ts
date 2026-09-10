/**
 * Who may create an account: the addresses in allowed_emails.csv at the project
 * root (or ALLOWLIST_PATH). One address per line in the first column; an
 * "email" header row, blank lines and lines starting with # are skipped.
 *
 * Read on every sign-up rather than cached, so inviting someone is an edit to
 * the file with no restart. A missing or empty file means nobody can sign up —
 * failing closed, because open sign-up on a public server would spend the AI
 * key on strangers.
 *
 * The file is gitignored: the repository is public, and these are people's
 * email addresses. allowed_emails.example.csv is the template.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Resolved when asked, not at import, so a value from .env is honoured. */
export function allowlistPath(): string {
  return resolve(process.env.ALLOWLIST_PATH ?? "allowed_emails.csv");
}

export function allowedEmails(): Set<string> {
  let text: string;
  try {
    text = readFileSync(allowlistPath(), "utf8");
  } catch {
    return new Set();
  }

  const emails = new Set<string>();
  // Excel saves CSV with a byte-order mark, which would glue itself to the
  // header — or to the first address, if there is no header.
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const first = (line.split(",")[0] ?? "")
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim()
      .toLowerCase();
    if (!first || first.startsWith("#") || first === "email") continue;
    emails.add(first);
  }
  return emails;
}

export function mayRegister(email: string): boolean {
  return allowedEmails().has(email.trim().toLowerCase());
}
