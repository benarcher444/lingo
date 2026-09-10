import type { Language, User } from "../db/schema.js";

/** Escape untrusted text for HTML interpolation. Every user value goes through this. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape for embedding inside a <script> JSON blob. */
export function jsonScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export const icons = {
  pen: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  ear: icon(
    '<path d="M6 8.5a6 6 0 1 1 12 0c0 2.5-1.5 3.5-2.5 4.5S14 15 14 17a3 3 0 0 1-6 0"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0"/>',
  ),
  chat: icon('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/>'),
  book: icon(
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  ),
  chart: icon('<path d="M3 3v18h18"/><path d="M18.5 8.5 13 14l-3-3-4.5 4.5"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  globe: icon('<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>'),
  speaker: icon(
    '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  ),
  arrowRight: icon('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  trash: icon('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  check: icon('<path d="M20 6 9 17l-5-5"/>'),
  sparkle: icon('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>'),
  cog: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>'),
  logout: icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
  /** Half-filled circle: follow the device. */
  contrast: icon('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>'),
  sun: icon(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ),
  moon: icon('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>'),
};

export interface NavContext {
  user: User;
  languages: Language[];
  currentLanguage: Language | null;
  active: string;
}

interface NavLink {
  href: string;
  label: string;
  short: string;
  key: string;
  svg: string;
}

function navLinks(languageId: number | null): NavLink[] {
  const q = languageId ? `?language=${languageId}` : "";
  return [
    { href: `/practice/written${q}`, label: "Written practice", short: "Written", key: "written", svg: icons.pen },
    { href: `/practice/audio${q}`, label: "Listening practice", short: "Listen", key: "audio", svg: icons.ear },
    { href: `/practice/chat${q}`, label: "Conversation", short: "Chat", key: "chat", svg: icons.chat },
    { href: `/vocab${q}`, label: "Vocabulary", short: "Words", key: "vocab", svg: icons.book },
    { href: `/progress${q}`, label: "Progress", short: "Progress", key: "progress", svg: icons.chart },
  ];
}

function languageOptions(ctx: NavContext): string {
  return ctx.languages
    .map(
      (l) =>
        `<option value="${l.id}"${l.id === ctx.currentLanguage?.id ? " selected" : ""}>${esc(l.name)}</option>`,
    )
    .join("");
}

function languagePicker(ctx: NavContext): string {
  if (ctx.languages.length === 0) return "";

  return `
    <form method="get" action="/switch-language" class="stack-sm" style="padding: 0 10px 6px">
      <label class="nav-label" style="padding:0 0 4px" for="lang-picker">Language</label>
      <select id="lang-picker" class="select" name="language" onchange="this.form.submit()">
        ${languageOptions(ctx)}
      </select>
      <input type="hidden" name="return" value="${esc(ctx.active)}">
    </form>`;
}

/**
 * The phone's copy of the picker, in the top bar. On a phone the sidebar is
 * hidden behind the bottom tab bar, and with it the only way to switch language.
 */
function mobileLanguagePicker(ctx: NavContext): string {
  if (ctx.languages.length === 0) return "";

  return `
    <form method="get" action="/switch-language" class="mobile-lang">
      <select class="select" name="language" aria-label="Language" onchange="this.form.submit()">
        ${languageOptions(ctx)}
      </select>
      <input type="hidden" name="return" value="${esc(ctx.active)}">
    </form>`;
}

export type Theme = User["theme"];

const THEME_CHOICES: { value: Theme; label: string; title: string; svg: string }[] = [
  { value: "auto", label: "Auto", title: "Theme: follow this device", svg: icons.contrast },
  { value: "light", label: "Light", title: "Theme: always light", svg: icons.sun },
  { value: "dark", label: "Dark", title: "Theme: always dark", svg: icons.moon },
];

/**
 * Auto / Light / Dark, in the desktop sidebar and on Settings. Saved to the
 * account (POST /preferences/theme) and applied as the page is built, so the
 * right colours are there from the first paint on every device.
 */
export function themeSwitch(current: Theme): string {
  const buttons = THEME_CHOICES.map(
    (c) =>
      `<button type="submit" name="theme" value="${c.value}" title="${c.title}" aria-pressed="${c.value === current}">${c.svg}<span>${c.label}</span></button>`,
  ).join("");

  return `<form method="post" action="/preferences/theme" class="theme-switch" aria-label="Colour theme">${buttons}</form>`;
}

/** Forced themes stamp the root; "auto" leaves it to prefers-color-scheme. */
function themeAttributes(theme: Theme): string {
  return theme === "auto" ? "" : ` data-theme="${theme}"`;
}

/** Tells the browser which palette its own controls and scrollbars should use. */
function colorSchemeMeta(theme: Theme): string {
  return `<meta name="color-scheme" content="${theme === "auto" ? "light dark" : theme}">`;
}

export interface LayoutOptions {
  title: string;
  body: string;
  /**
   * Data handed to the page's client script. Emitted as a classic <script>,
   * which runs immediately — module scripts are deferred, so a static `import`
   * would otherwise execute before this assignment and see `undefined`.
   */
  clientData?: { name: string; value: unknown };
  /** Path to a module under /static to load after the data is in place. */
  clientModule?: string;
}

export function layout(ctx: NavContext, opts: LayoutOptions): string {
  const links = navLinks(ctx.currentLanguage?.id ?? null);
  const initial = (ctx.user.email[0] ?? "?").toUpperCase();
  const theme = ctx.user.theme;

  const sidebarNav = links
    .map(
      (l) =>
        `<a class="nav-item" href="${l.href}"${l.key === ctx.active ? ' aria-current="page"' : ""}>${l.svg}<span>${l.label}</span></a>`,
    )
    .join("\n");

  // A phone has no sidebar, so Settings (language, account, theme) gets a tab.
  const mobileNav = [
    ...links,
    { href: "/settings", label: "Settings", short: "Settings", key: "settings", svg: icons.cog },
  ]
    .map(
      (l) =>
        `<a href="${l.href}"${l.key === ctx.active ? ' aria-current="page"' : ""}>${l.svg}<span>${l.short}</span></a>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en"${themeAttributes(theme)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${colorSchemeMeta(theme)}
<title>${esc(opts.title)} · Lingo</title>
<link rel="stylesheet" href="/static/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📖</text></svg>">
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <a class="brand" href="/"><span class="brand-mark">L</span><span>Lingo</span></a>
    ${languagePicker(ctx)}
    <div class="nav-label">Practice</div>
    ${sidebarNav}
    <div class="sidebar-foot">
      <div class="sidebar-user">
        <span class="avatar">${esc(initial)}</span>
        <span class="sidebar-email">${esc(ctx.user.email)}</span>
      </div>
      <div class="sidebar-theme">${themeSwitch(theme)}</div>
      <a class="nav-item" href="/settings"${ctx.active === "settings" ? ' aria-current="page"' : ""}>${icons.cog}<span>Settings</span></a>
      <form method="post" action="/logout">
        <button class="nav-item" type="submit" style="width:100%;border:0;background:none;font:inherit;cursor:pointer;text-align:left">
          ${icons.logout}<span>Sign out</span>
        </button>
      </form>
    </div>
  </aside>

  <main class="main">
    <div class="mobile-head">
      <a class="mobile-brand" href="/"><span class="brand-mark">L</span><span>Lingo</span></a>
      ${mobileLanguagePicker(ctx)}
    </div>
    <div class="container">
      ${opts.body}
    </div>
  </main>
</div>

<nav class="mobile-bar">
  ${mobileNav}
</nav>
${
  opts.clientData
    ? `<script>window.${opts.clientData.name} = ${jsonScript(opts.clientData.value)};</script>`
    : ""
}
${opts.clientModule ? `<script type="module" src="${esc(opts.clientModule)}"></script>` : ""}
</body>
</html>`;
}

export function authLayout(opts: { title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(opts.title)} · Lingo</title>
<link rel="stylesheet" href="/static/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📖</text></svg>">
</head>
<body>
<div class="auth-page">
  <div class="auth-card">
    <div class="auth-brand"><span class="brand-mark">L</span><span>Lingo</span></div>
    ${opts.body}
  </div>
</div>
</body>
</html>`;
}
