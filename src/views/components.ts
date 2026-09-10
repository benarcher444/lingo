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

  const learntWidth = summary.total > 0 ? (100 * summary.learnt) / summary.total : 0;
  const learningWidth =
    summary.total > 0 ? (100 * summary.inProgress) / summary.total : 0;

  const median = medianOf(types.map((t) => t.total));

  const cells = types
    .map((t) => {
      const tLearnt = t.total > 0 ? (100 * t.learnt) / t.total : 0;
      const tLearning = t.total > 0 ? (100 * t.inProgress) / t.total : 0;
      // "Thin" = noticeably smaller than the typical category, so it is the
      // natural place to add words next.
      const thin = types.length > 2 && t.total < median * 0.6;
      const href = opts.linkBase ? `${opts.linkBase}&type=${t.wordTypeId}` : null;
      const tag = href ? "a" : "div";
      const attrs = href ? ` href="${esc(href)}"` : "";

      return `<${tag} class="type-cell${thin ? " is-thin" : ""}"${attrs}>
        <div class="name"><span>${esc(t.wordTypeName)}</span><span class="count">${t.total}</span></div>
        <div class="bar"><i class="learnt" style="width:${tLearnt.toFixed(1)}%"></i><i class="learning" style="width:${tLearning.toFixed(1)}%"></i></div>
        <div class="pct">${t.pctLearnt.toFixed(0)}% learnt${thin ? " · thin" : ""}</div>
      </${tag}>`;
    })
    .join("\n");

  return `<section class="progress-banner">
  <div class="banner-top">
    <div class="banner-figure">
      <div class="ring" style="--pct:${pct.toFixed(1)}"><span>${pct.toFixed(0)}%</span></div>
      <div class="banner-figure-text">
        <div class="big">${summary.learnt} of ${summary.total} learnt</div>
        <div class="small">${esc(opts.languageName)} · ${opts.mode === "audio" ? "listening" : "written"}</div>
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
    <i class="learnt" style="width:${learntWidth.toFixed(1)}%"></i><i class="learning" style="width:${learningWidth.toFixed(1)}%"></i>
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
