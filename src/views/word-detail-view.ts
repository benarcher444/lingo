import {
  COMPLETELY_LEARNT_THRESHOLD,
  LEARNT_THRESHOLD,
  type Direction,
} from "../algorithm.js";
import type { ModeStats, WordDetail } from "../word-detail.js";
import { lineChart } from "./charts.js";
import { scorePill } from "./components.js";
import { esc, icons } from "./layout.js";

const DIRECTION_LABEL: Record<Direction, string> = {
  to_english: "To English",
  from_english: "From English",
  listen: "Listening",
};

function statRow(label: string, value: string, muted = false): string {
  return `<div class="detail-stat">
    <span class="detail-stat-label">${esc(label)}</span>
    <span class="detail-stat-value${muted ? " hint" : ""}">${esc(value)}</span>
  </div>`;
}

function modeCard(stats: ModeStats, languageName: string): string {
  const title = stats.mode === "written" ? "Written practice" : "Listening practice";

  if (!stats.enabled) {
    return `<div class="detail-mode">
      <div class="detail-mode-head"><h3>${esc(title)}</h3>
        <span class="pill pill-plain">Not enabled</span></div>
      <p class="hint">Turn this on when editing the word to include it here.</p>
    </div>`;
  }

  if (stats.totalTested === 0) {
    return `<div class="detail-mode">
      <div class="detail-mode-head"><h3>${esc(title)}</h3>
        <span class="pill pill-new">Never tested</span></div>
      <p class="hint">Practise this word and its figures will appear here.</p>
    </div>`;
  }

  const b = stats.breakdown;

  const directions = stats.directions
    .map(
      (d) => `
      <div class="detail-direction">
        <div class="detail-direction-name">
          ${esc(
            d.direction === "to_english"
              ? `${languageName} → English`
              : d.direction === "from_english"
                ? `English → ${languageName}`
                : DIRECTION_LABEL[d.direction],
          )}
        </div>
        <div class="detail-direction-grid">
          ${statRow("Times tested", String(d.tested))}
          ${statRow("Correct", String(d.correct))}
          ${statRow("Wrong", String(d.wrong))}
          ${statRow("Accuracy", `${d.accuracy.toFixed(0)}%`)}
          ${statRow("Streak", `${d.streak} of 3`)}
          ${statRow("Last tested", d.lastTested ?? "never", !d.lastTested)}
        </div>
      </div>`,
    )
    .join("");

  return `<div class="detail-mode">
    <div class="detail-mode-head">
      <h3>${esc(title)}</h3>
      <div class="row">
        ${scorePill(stats.score)}
        <span class="detail-score">${stats.score.toFixed(2)}</span>
      </div>
    </div>

    ${directions}

    <div class="detail-breakdown">
      <div class="detail-breakdown-title">How that score is made up</div>
      <div class="detail-formula">
        <span class="term-add">+${b.accuracy.toFixed(2)}</span> <span class="hint">accuracy</span>
        <span class="term-add">+${b.volume.toFixed(2)}</span> <span class="hint">volume</span>
        <span class="term-add">+${b.streak.toFixed(2)}</span> <span class="hint">streak</span>
        <span class="term-sub">−${b.neglect.toFixed(2)}</span>
        <span class="hint">neglect (${b.daysSinceTested} day${b.daysSinceTested === 1 ? "" : "s"})</span>
        <span class="detail-formula-total">= ${b.total.toFixed(2)}</span>
      </div>
    </div>
  </div>`;
}

export function wordDetailPanel(detail: WordDetail, closeHref: string): string {
  const history = detail.scoreHistory;

  const chart =
    history.length >= 2
      ? lineChart([{ name: "Score", colour: "var(--accent)", points: history }], {
          yLabel: "Score",
          thresholds: [
            { value: LEARNT_THRESHOLD, label: "learnt", colour: "var(--learnt)" },
            {
              value: COMPLETELY_LEARNT_THRESHOLD,
              label: "solid",
              colour: "var(--learnt)",
            },
          ],
        })
      : `<div class="empty" style="padding:28px 20px"><p>${
          history.length === 0
            ? "No practice recorded yet — the score history appears after your first session."
            : "One answer so far. The line builds as you practise."
        }</p></div>`;

  const attempts =
    detail.recentAttempts.length === 0
      ? `<p class="hint">Nothing yet.</p>`
      : `<div class="attempt-list">${detail.recentAttempts
          .map(
            (a) => `
        <div class="attempt ${a.correct ? "attempt-right" : "attempt-wrong"}">
          <span class="attempt-mark">${a.correct ? "✓" : "✗"}</span>
          <span class="attempt-dir">${esc(DIRECTION_LABEL[a.direction])}</span>
          <span class="attempt-given">${
            a.givenAnswer ? esc(a.givenAnswer) : '<span class="hint">skipped</span>'
          }</span>
          ${a.overridden ? '<span class="pill pill-plain">overridden</span>' : ""}
          <span class="attempt-when hint">${esc(a.answeredAt.slice(0, 10))}</span>
        </div>`,
          )
          .join("")}</div>`;

  return `<div class="card detail-card">
    <div class="card-head">
      <div>
        <h2 class="term" style="font-size:1.35rem">${esc(detail.term)}</h2>
        <div class="sub">${esc(detail.english)} · <span class="pill pill-plain">${esc(detail.wordTypeName)}</span></div>
        ${detail.notes ? `<div class="hint" style="margin-top:4px">${esc(detail.notes)}</div>` : ""}
      </div>
      <a class="btn btn-sm" href="${esc(closeHref)}">Close</a>
    </div>

    <div class="card-body stack">
      <div class="card">
        <div class="card-head"><div><h2>Score over time</h2>
          <div class="sub">Replayed from every answer. It climbs when you practise and drifts down when you do not.</div></div></div>
        <div class="card-body chart-box">${chart}</div>
      </div>

      <div class="detail-modes">
        ${detail.modes.map((m) => modeCard(m, detail.languageName)).join("")}
      </div>

      <div>
        <div class="detail-breakdown-title">Recent answers</div>
        ${attempts}
      </div>

      <div class="hint">Added ${esc(detail.createdAt.slice(0, 10))} ${icons.book ? "" : ""}</div>
    </div>
  </div>`;
}
