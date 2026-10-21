import type { Summary, TypeSummary } from "../stats.js";
import { esc, icons } from "./layout.js";

/**
 * The banner that sits at the top of the vocabulary page: overall completion,
 * plus a per-word-type breakdown so it is obvious where new words are worth
 * adding. Thin categories are tinted to draw the eye.
 */
export function progressBanner(opts: {
  summary: Summary;
  types: TypeSummary[];
  languageName: string;
  mode?: "written" | "audio";
  linkBase?: string;
}): string {
  const { summary, types } = opts;
  const pct = summary.pctLearnt;

  // Solid and learnt as separate bands, the deeper green for solid, as on the
  // Progress page. A single "learnt" band hid how much of it was solid.
  const share = (n: number, of: number) => (of > 0 ? (100 * n) / of : 0);
  const bands = (s: Summary) =>
    `<i class="solid" style="width:${share(s.completelyLearnt, s.total).toFixed(1)}%"></i>` +
    `<i class="learnt-only" style="width:${share(s.learntNotSolid, s.total).toFixed(1)}%"></i>` +
    `<i class="learning" style="width:${share(s.inProgress, s.total).toFixed(1)}%"></i>`;

  // The ring is drawn as four arcs in the same colours as the tiles beside it,
  // so it shows the whole vocabulary rather than one "learnt" slice against a
  // blank remainder. Each stop is cumulative: where one ends, the next begins.
  const solidPct = share(summary.completelyLearnt, summary.total);
  const learntPct = solidPct + share(summary.learntNotSolid, summary.total);
  const learningPct = learntPct + share(summary.inProgress, summary.total);
  const ringStyle =
    `--solid:${solidPct.toFixed(1)};--learnt:${learntPct.toFixed(1)};` +
    `--learning:${learningPct.toFixed(1)}`;
  const ringTitle =
    `${summary.completelyLearnt} solid · ${summary.learntNotSolid} learnt · ` +
    `${summary.inProgress} learning · ${summary.untouched} untouched`;

  /**
   * Conjugations are forms of a verb you already have, and phrases are
   * sentences — neither is a new word, so counting them flatters the total.
   * "True words" is the learnt count without them, shown only where the
   * language has such a category, or it would just repeat the headline.
   */
  const NOT_REALLY_WORDS = new Set(["conjugations", "phrases"]);
  const trueTypes = types.filter((t) => !NOT_REALLY_WORDS.has(t.wordTypeName.toLowerCase()));
  const hasExcluded = trueTypes.length < types.length;
  const trueLearnt = trueTypes.reduce((n, t) => n + t.learnt, 0);
  const trueTotal = trueTypes.reduce((n, t) => n + t.total, 0);

  const median = medianOf(types.map((t) => t.total));

  const cells = types
    .map((t) => {
      // "Thin" = noticeably smaller than the typical category, so it is the
      // natural place to add words next.
      const thin = types.length > 2 && t.total < median * 0.6;
      const href = opts.linkBase ? `${opts.linkBase}&type=${t.wordTypeId}` : null;
      const tag = href ? "a" : "div";
      const attrs = href ? ` href="${esc(href)}"` : "";

      return `<${tag} class="type-cell${thin ? " is-thin" : ""}"${attrs}>
        <div class="name"><span>${esc(t.wordTypeName)}</span><span class="count">${t.total}</span></div>
        <div class="bar">${bands(t)}</div>
        <div class="pct">${t.pctLearnt.toFixed(0)}% learnt${thin ? " · thin" : ""}</div>
      </${tag}>`;
    })
    .join("\n");

  return `<section class="progress-banner">
  <div class="banner-top">
    <div class="banner-figure">
      <div class="ring" style="${ringStyle}" title="${esc(ringTitle)}"><span>${pct.toFixed(0)}%</span></div>
      <div class="banner-figure-text">
        <div class="big">${summary.learnt} of ${summary.total} learnt</div>
        <div class="small">${esc(opts.languageName)} · ${opts.mode === "audio" ? "listening" : "written"}</div>
        ${
          hasExcluded
            ? `<div class="true-words" title="Learnt, leaving out conjugations and phrases: those are forms of words you already have, and sentences, rather than new words">${trueLearnt} of ${trueTotal} true words</div>`
            : ""
        }
      </div>
    </div>
    <div class="banner-stats">
      <div class="mini-stat" title="Score above 2.556">
        <div class="value solid">${summary.completelyLearnt}</div><div class="label">Solid</div></div>
      <div class="mini-stat" title="Score above 2.3 but not yet solid">
        <div class="value learnt-only">${summary.learntNotSolid}</div><div class="label">Learnt</div></div>
      <div class="mini-stat" title="Practised, still below the learnt line">
        <div class="value learning">${summary.inProgress}</div><div class="label">Learning</div></div>
      <div class="mini-stat" title="Never tested">
        <div class="value new">${summary.untouched}</div><div class="label">Untouched</div></div>
      <div class="mini-stat"><div class="value">${summary.averageScore.toFixed(2)}</div><div class="label">Avg score</div></div>
    </div>
  </div>
  ${
    types.length > 0
      ? `<div class="type-strip">${cells}</div>`
      : `<div style="padding:14px 20px;color:var(--text-muted);font-size:0.86rem;border-top:1px solid var(--border)">No word types yet.</div>`
  }
  <div class="bar" style="border-radius:0;height:3px;margin:0">
    ${bands(summary)}
  </div>
</section>`;
}

/**
 * Shown on every practice and insight page while the vocabulary is empty.
 * Always names the concrete next action rather than just stating the problem.
 */
export function emptyState(opts: {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  icon?: string;
}): string {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${opts.icon ?? icons.book}</div>
    <h2>${esc(opts.title)}</h2>
    <p>${esc(opts.body)}</p>
    <div class="row" style="justify-content:center">
      ${
        opts.actionHref
          ? `<a class="btn btn-primary" href="${esc(opts.actionHref)}">${icons.plus}${esc(opts.actionLabel ?? "Add words")}</a>`
          : ""
      }
      ${
        opts.secondaryHref
          ? `<a class="btn" href="${esc(opts.secondaryHref)}">${esc(opts.secondaryLabel ?? "Learn more")}</a>`
          : ""
      }
    </div>
  </div></div>`;
}

export function pageHead(opts: {
  title: string;
  sub?: string;
  actions?: string;
}): string {
  return `<div class="page-head">
    <div>
      <h1>${esc(opts.title)}</h1>
      ${opts.sub ? `<p class="sub">${esc(opts.sub)}</p>` : ""}
    </div>
    ${opts.actions ? `<div class="head-actions">${opts.actions}</div>` : ""}
  </div>`;
}

/**
 * For fields where you type words rather than personal details.
 *
 * It says the field is not a login, an address or a card, so a phone does not
 * offer to fill one above the keyboard — `autocomplete="off"` alone is not
 * honoured everywhere, so the data- attributes add the opt-outs password
 * managers read (1Password, LastPass, Bitwarden, Dashlane).
 *
 * It also stops a phone capitalising the first letter: vocabulary is written
 * lower case, and the owner was undoing the capital on every word.
 */
export const NO_AUTOFILL =
  'autocomplete="off" autocapitalize="none" data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other"';

export function alert(kind: "error" | "ok" | "info", message: string): string {
  return `<div class="alert alert-${kind}">${esc(message)}</div>`;
}

export function scorePill(score: number): string {
  if (score > 2.556) return `<span class="pill pill-learnt">Solid</span>`;
  if (score > 2.3) return `<span class="pill pill-learnt">Learnt</span>`;
  if (score > 0) return `<span class="pill pill-learning">Learning</span>`;
  return `<span class="pill pill-new">New</span>`;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}
