import { COMPLETELY_LEARNT_THRESHOLD, LEARNT_THRESHOLD, type Mode } from "../algorithm.js";
import type { Summary, TypeSummary } from "../stats.js";
import { esc, icons } from "./layout.js";

/** What each mode is called on screen, and the colour it is drawn in. */
export const MODE_LABEL: Record<Mode, string> = {
  written: "Written",
  audio: "Listening",
  speak: "Speaking",
};

export const MODE_COLOUR: Record<Mode, string> = {
  written: "var(--accent)",
  audio: "var(--listening)",
  speak: "var(--speaking)",
};

export const MODE_ICON: Record<Mode, string> = {
  written: icons.pen,
  audio: icons.ear,
  speak: icons.speak,
};

/**
 * The banner that sits at the top of the vocabulary page: overall completion,
 * plus a per-word-type breakdown, so every category's count and standing is
 * visible at a glance. It deliberately does not flag a category for being
 * small: a language has only a handful of beginner conjunctions and
 * prepositions, so that marked a gap that did not exist.
 */
export function progressBanner(opts: {
  summary: Summary;
  types: TypeSummary[];
  languageName: string;
  mode?: Mode;
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

  const cells = types
    .map((t) => {
      const href = opts.linkBase ? `${opts.linkBase}&type=${t.wordTypeId}` : null;
      const tag = href ? "a" : "div";
      const attrs = href ? ` href="${esc(href)}"` : "";

      return `<${tag} class="type-cell"${attrs}>
        <div class="name"><span>${esc(t.wordTypeName)}</span><span class="count">${t.total}</span></div>
        <div class="bar">${bands(t)}</div>
        <div class="pct">${t.pctLearnt.toFixed(0)}% learnt</div>
      </${tag}>`;
    })
    .join("\n");

  return `<section class="progress-banner">
  <div class="banner-top">
    <div class="banner-figure">
      <div class="ring" style="${ringStyle}" title="${esc(ringTitle)}"><span>${pct.toFixed(0)}%</span></div>
      <div class="banner-figure-text">
        <div class="big">${summary.learnt} of ${summary.total} learnt</div>
        <div class="small">${esc(opts.languageName)} · ${MODE_LABEL[opts.mode ?? "written"].toLowerCase()}</div>
        ${
          // The listening and speaking totals are smaller than the vocabulary
          // and the reason has to be on the page, or the number looks like a
          // bug. The banner knows the mode, so no caller has to remember.
          opts.mode === "speak"
            ? `<div class="banner-note">Only words solid in written and listening</div>`
            : opts.mode === "audio"
              ? `<div class="banner-note">Only words you have answered in written</div>`
              : ""
        }
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
  /** Defaults to a plus, which is right for "add" and wrong for "go". */
  actionIcon?: string;
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
          ? `<a class="btn btn-primary" href="${esc(opts.actionHref)}">${opts.actionIcon ?? icons.plus}${esc(opts.actionLabel ?? "Add words")}</a>`
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

export const SCORE_BANDS = ["new", "learning", "learnt", "solid"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const BAND_LABEL: Record<ScoreBand, string> = {
  new: "New",
  learning: "Learning",
  learnt: "Learnt",
  solid: "Solid",
};

/**
 * Which band a score falls in. The pill below and the vocabulary page's status
 * filter both come through here, so a filter can never disagree with the pill
 * sitting next to it. The thresholds are imported rather than written out:
 * they were copied here once and would have had to be found again.
 */
export function scoreBand(score: number): ScoreBand {
  if (score > COMPLETELY_LEARNT_THRESHOLD) return "solid";
  if (score > LEARNT_THRESHOLD) return "learnt";
  if (score > 0) return "learning";
  return "new";
}

export function scorePill(score: number): string {
  const band = scoreBand(score);
  // Solid and learnt share a colour; the word tells them apart.
  const tone = band === "solid" ? "learnt" : band;
  return `<span class="pill pill-${tone}">${BAND_LABEL[band]}</span>`;
}
