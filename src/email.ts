/**
 * Sending mail — one interface, providers behind it.
 *
 * The same shape as `src/ai.ts`, for the same reason: which service carries
 * the mail is **configuration, not a decision baked into the code**. Swapping
 * Gmail for Postmark when this gets a real domain should be a line in `.env`,
 * not a rewrite.
 *
 * Two providers:
 *
 * - **`console`** prints the message, link and all, to the server log. It is
 *   the equivalent of `AI_PROVIDER=mock`: it makes the whole password-reset
 *   flow testable with no credentials, no network and no bill, and it keeps
 *   the app working offline. It is the default, because a missing
 *   configuration should degrade to "the operator can still read the link"
 *   rather than to a 500.
 * - **`smtp`** actually sends, through nodemailer. Chosen automatically when
 *   `SMTP_HOST` is set, so production needs no extra flag.
 *
 * **The provider is chosen per call, not at import.** `src/ai.ts` chooses at
 * import and that is precisely why `src/env.ts` has to be imported first —
 * a trap documented in CLAUDE.md. Deciding at call time costs nothing here
 * and removes the ordering hazard entirely.
 *
 * Nodemailer is imported lazily for the same reason: a console-only install
 * that never sends mail should not have to have it present.
 */

export interface Mail {
  to: string;
  subject: string;
  /** Plain text only. Nothing here needs HTML, and plain text cannot phish. */
  text: string;
}

export type EmailProvider = "console" | "smtp";

export interface Sent {
  provider: EmailProvider;
  /** For the server log and the operator. Never shown to a visitor. */
  detail: string;
}

/** Thrown when a provider is configured but cannot be used. */
export class EmailFailed extends Error {
  constructor(
    message: string,
    readonly provider: EmailProvider,
  ) {
    super(message);
    this.name = "EmailFailed";
  }
}

const value = (name: string): string | undefined => {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Which provider a send would use right now. `EMAIL_PROVIDER` wins if it names
 * one; otherwise the presence of `SMTP_HOST` decides, so a configured server
 * sends and an unconfigured laptop logs.
 */
export function emailProvider(): EmailProvider {
  const named = value("EMAIL_PROVIDER")?.toLowerCase();
  if (named === "console" || named === "smtp") return named;
  return value("SMTP_HOST") ? "smtp" : "console";
}

/** The address mail is sent from, and the one replies would go to. */
export function emailFrom(): string {
  return value("EMAIL_FROM") ?? value("SMTP_USER") ?? "lingo@localhost";
}

/**
 * Where links in an email should point.
 *
 * `APP_URL` wins, and should be set in production. The fallback derives the
 * origin from the request, which is **why this takes one**: a link built from
 * an attacker-controlled `Host` header is the classic way a password-reset
 * email is turned into a credential thief. `trustProxy` is loopback-only here,
 * so behind Caddy the host is real — but an explicit `APP_URL` does not depend
 * on that staying true.
 */
export function appUrl(fallbackOrigin?: string): string {
  const configured = value("APP_URL");
  const base = configured ?? fallbackOrigin ?? "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

async function sendOverSmtp(mail: Mail): Promise<Sent> {
  const host = value("SMTP_HOST");
  if (!host) throw new EmailFailed("SMTP_HOST is not set.", "smtp");

  let nodemailer: typeof import("nodemailer");
  try {
    nodemailer = await import("nodemailer");
  } catch {
    throw new EmailFailed("nodemailer is not installed — run npm install.", "smtp");
  }

  const port = Number(value("SMTP_PORT") ?? 587);
  // Port 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this wrong
  // is the usual reason a first send hangs rather than fails.
  const secure = (value("SMTP_SECURE") ?? (port === 465 ? "true" : "false")) === "true";
  const user = value("SMTP_USER");
  const pass = value("SMTP_PASS");

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  try {
    const info = await transport.sendMail({
      from: emailFrom(),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    return { provider: "smtp", detail: `sent via ${host} (${info.messageId})` };
  } catch (error) {
    throw new EmailFailed(
      error instanceof Error ? error.message : "The mail server refused the message.",
      "smtp",
    );
  } finally {
    transport.close();
  }
}

/**
 * Send one message. Throws `EmailFailed` if a configured provider could not
 * deliver — the caller decides whether that is worth telling the visitor,
 * and for a password reset it deliberately is not.
 */
export async function sendMail(mail: Mail): Promise<Sent> {
  const provider = emailProvider();
  if (provider === "smtp") return sendOverSmtp(mail);

  // Deliberately the whole message. The point of this provider is that the
  // link is readable without a mail server.
  console.log(
    [
      "",
      "─── email (console provider; set SMTP_HOST to send for real) ───",
      `To:      ${mail.to}`,
      `From:    ${emailFrom()}`,
      `Subject: ${mail.subject}`,
      "",
      mail.text,
      "────────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
  return { provider: "console", detail: "written to the server log" };
}
