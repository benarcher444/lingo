import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import type { Mode } from "../algorithm.js";
import { requireContext } from "../context.js";
import { db } from "../db/index.js";
import { attempts, statSnapshots, wordTypes, words } from "../db/schema.js";
import { loadScoredWords, summarise, summariseByType } from "../stats.js";
import { activityChart, barChart, legend, lineChart, type Series } from "../views/charts.js";
import { emptyState, pageHead } from "../views/components.js";
import { esc, icons, layout } from "../views/layout.js";

const SERIES_COLOURS = [
  "var(--accent)",
  "var(--learnt)",
  "var(--learning)",
  "#d9679a",
  "#4aa3d9",
  "#9b7bd4",
  "#d98d4a",
  "#4ac0a8",
];

/** Measures you can plot, in the order they are offered. */
const MEASURES = {
  percentage_learnt: { label: "Percentage learnt", suffix: "%" },
  words_learnt: { label: "Words learnt", suffix: "" },
  words_completely_learnt: { label: "Words solid", suffix: "" },
  words_learning: { label: "Words still learning", suffix: "" },
  new_words: { label: "Words untouched", suffix: "" },
  average_score: { label: "Average score", suffix: "" },
  average_accuracy: { label: "Average accuracy", suffix: "%" },
  total_words: { label: "Total words", suffix: "" },
  highest_days_since_last_tested: { label: "Longest neglect (days)", suffix: "" },
} as const;

type MeasureKey = keyof typeof MEASURES;

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  app.get("/progress", async (request, reply) => {
    const ctx = requireContext(request, reply, "progress");
    if (!ctx) return;

    const head = pageHead({
      title: "Progress",
      sub: "How much of your vocabulary is holding, and where the gaps are.",
    });

    if (!ctx.currentLanguage) {
      return reply.type("text/html").send(
        layout(ctx, {
          title: "Progress",
          body:
            head +
            emptyState({
              title: "No language yet",
              body: "Create a language and add some vocabulary — your progress will be charted here.",
              actionHref: "/vocab",
              actionLabel: "Go to vocabulary",
              icon: icons.globe,
            }),
        }),
      );
    }

    const language = ctx.currentLanguage;
    const query = request.query as Record<string, string | string[] | undefined>;
    const mode: Mode = query["mode"] === "audio" ? "audio" : "written";

    const scored = loadScoredWords(language.id, mode);

    if (scored.length === 0) {
      return reply.type("text/html").send(
        layout(ctx, {
          title: "Progress",
          body:
            head +
            emptyState({
              title: "Please add some words to your vocabulary to start",
              body: `There is nothing to chart yet. Add some ${language.name} words, do a session or two, and this page fills in.`,
              actionHref: `/vocab?language=${language.id}`,
              actionLabel: "Add words",
              icon: icons.chart,
            }),
        }),
      );
    }

    const summary = summarise(scored, mode);
    const types = summariseByType(scored, mode);

    /* ---- What to plot ---- */

    const requestedMeasure = String(query["measure"] ?? "");
    const measure: MeasureKey =
      requestedMeasure in MEASURES ? (requestedMeasure as MeasureKey) : "percentage_learnt";

    // Categories are checkboxes, so this arrives as a string, an array, or not
    // at all. Absent means "everything", which is the useful default.
    const rawCats = query["cats"];
    const requestedCats = (
      Array.isArray(rawCats) ? rawCats : rawCats === undefined ? [] : [rawCats]
    )
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n));

    // A hidden marker distinguishes "the user chose nothing" from "first visit,
    // no query string". Without it, unticking every category read as "show
    // everything", so the overall line could never be seen on its own.
    const explicitSelection = query["filtered"] === "1";

    const showAllCategories = !explicitSelection && requestedCats.length === 0;
    const selectedCats = new Set(
      showAllCategories ? types.map((t) => t.wordTypeId) : requestedCats,
    );

    // On a first visit the overall line is on; after that the checkbox decides.
    const includeOverall = explicitSelection ? query["overall"] === "1" : true;

    /* ---- The series ---- */

    const history = db
      .select({
        wordTypeId: statSnapshots.wordTypeId,
        takenAt: statSnapshots.takenAt,
        value: statSnapshots.value,
      })
      .from(statSnapshots)
      .where(
        and(
          eq(statSnapshots.languageId, language.id),
          eq(statSnapshots.mode, mode),
          eq(statSnapshots.measure, measure),
        ),
      )
      .orderBy(statSnapshots.takenAt)
      .all();

    const typeNames = new Map(types.map((t) => [t.wordTypeId, t.wordTypeName]));
    const grouped = new Map<string, { x: number; y: number }[]>();

    for (const row of history) {
      if (row.wordTypeId === null) {
        if (!includeOverall) continue;
      } else if (!selectedCats.has(row.wordTypeId)) {
        continue;
      }

      const key =
        row.wordTypeId === null
          ? "All categories"
          : (typeNames.get(row.wordTypeId) ?? "Removed category");

      const bucket = grouped.get(key) ?? [];
      bucket.push({ x: Date.parse(row.takenAt), y: row.value });
      grouped.set(key, bucket);
    }

    const series: Series[] = [...grouped.entries()]
      .sort((a, b) => (a[0] === "All categories" ? -1 : b[0] === "All categories" ? 1 : 0))
      .map(([name, points], i) => ({
        name,
        colour: SERIES_COLOURS[i % SERIES_COLOURS.length]!,
        points,
      }));

    /* ---- Activity, honouring the same category selection ---- */

    const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

    const activityConditions = [
      eq(wordTypes.languageId, language.id),
      eq(attempts.mode, mode),
      gte(sql`substr(${attempts.answeredAt}, 1, 10)`, since),
    ];
    if (!showAllCategories) {
      activityConditions.push(inArray(words.wordTypeId, [...selectedCats]));
    }

    const activityRows = db
      .select({
        day: sql<string>`substr(${attempts.answeredAt}, 1, 10)`,
        count: sql<number>`count(*)`,
      })
      .from(attempts)
      .innerJoin(words, eq(words.id, attempts.wordId))
      .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
      .where(and(...activityConditions))
      .groupBy(sql`substr(${attempts.answeredAt}, 1, 10)`)
      .all();

    const activityMap = new Map(activityRows.map((r) => [r.day, r.count]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, count: activityMap.get(date) ?? 0 };
    });

    const totalAnswers = days.reduce((sum, d) => sum + d.count, 0);
    const activeDays = days.filter((d) => d.count > 0).length;

    /* ---- Today's practice, split by mode ----
       Deliberately ignores the mode toggle and the category filter: this is
       "what have I done today", and both modes count towards that. */

    const todayStamp = new Date().toISOString().slice(0, 10);

    const todayRows = db
      .select({
        mode: attempts.mode,
        answers: sql<number>`count(*)`,
        correct: sql<number>`sum(case when ${attempts.correct} then 1 else 0 end)`,
        /** Distinct words — how much of the vocabulary today touched. */
        words: sql<number>`count(distinct ${attempts.wordId})`,
        /**
         * Words counted once per session, so three sessions of 30, 30 and 40
         * total 100 even where the same word came up twice. That is how a daily
         * target is counted. Rows from before sessions were tracked have a null
         * session id; coalescing to the date groups each such day as one
         * session, which matches what the old figure meant.
         */
        wordsWithRepeats: sql<number>`count(distinct
          coalesce(${attempts.sessionId}, substr(${attempts.answeredAt}, 1, 10))
          || ':' || ${attempts.wordId})`,
      })
      .from(attempts)
      .innerJoin(words, eq(words.id, attempts.wordId))
      .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
      .where(
        and(
          eq(wordTypes.languageId, language.id),
          eq(sql`substr(${attempts.answeredAt}, 1, 10)`, todayStamp),
        ),
      )
      .groupBy(attempts.mode)
      .all();

    const todayFor = (m: Mode) => {
      const row = todayRows.find((r) => r.mode === m);
      return {
        answers: row?.answers ?? 0,
        correct: row?.correct ?? 0,
        words: row?.words ?? 0,
        wordsWithRepeats: row?.wordsWithRepeats ?? 0,
      };
    };

    const todayWritten = todayFor("written");
    const todayAudio = todayFor("audio");
    const todayTotalWords = todayWritten.words + todayAudio.words;

    const todayCard = (
      title: string,
      icon: string,
      stats: { answers: number; correct: number; words: number; wordsWithRepeats: number },
      colour: string,
    ) => {
      const pct = stats.answers > 0 ? Math.round((100 * stats.correct) / stats.answers) : 0;
      return `<div class="today-mode">
        <div class="today-mode-head">${icon}<span>${esc(title)}</span></div>

        <div class="today-pair">
          <div title="Counted once per session, so repeats across sessions add up — the figure to set a daily target against">
            <div class="today-figure" style="color:${colour}">${stats.wordsWithRepeats}</div>
            <div class="today-caption">words tested</div>
          </div>
          <div title="How many different words today touched, counting each once">
            <div class="today-figure today-figure-sub">${stats.words}</div>
            <div class="today-caption">different words</div>
          </div>
        </div>

        <div class="today-sub">
          ${
            stats.answers > 0
              ? `${stats.answers} answer${stats.answers === 1 ? "" : "s"} · ${pct}% right`
              : `<span class="hint">nothing yet today</span>`
          }
        </div>
      </div>`;
    };

    const todayTotalTested = todayWritten.wordsWithRepeats + todayAudio.wordsWithRepeats;

    /* ---- Status split ---- */

    const statusBands = [
      { label: "Solid", count: summary.completelyLearnt, colour: "var(--learnt)" },
      {
        label: "Learnt",
        count: summary.learntNotSolid,
        colour: "color-mix(in srgb, var(--learnt) 55%, var(--surface))",
      },
      { label: "Learning", count: summary.inProgress, colour: "var(--learning)" },
      { label: "Untouched", count: summary.untouched, colour: "var(--new)" },
    ];

    const splitBar = statusBands
      .filter((b) => b.count > 0)
      .map(
        (b) =>
          `<i style="width:${((100 * b.count) / summary.total).toFixed(2)}%;background:${b.colour}"
             title="${esc(b.label)}: ${b.count}"></i>`,
      )
      .join("");

    const body = `
      ${pageHead({
        title: "Progress",
        sub: `How much of your ${esc(language.name)} is holding, and where the gaps are.`,
        actions: `
          <a class="btn${mode === "written" ? " btn-primary" : ""}" href="/progress?language=${language.id}&mode=written">Written</a>
          <a class="btn${mode === "audio" ? " btn-primary" : ""}" href="/progress?language=${language.id}&mode=audio">Listening</a>`,
      })}

      <div class="stack">

        <!-- The chart leads: it is the reason to open this page. -->
        <div class="card">
          <div class="card-head">
            <div>
              <h2>${esc(MEASURES[measure].label)} over time</h2>
              <div class="sub">Recorded at the start and end of every session.</div>
            </div>
            <form method="get" action="/progress" class="row" id="measure-form">
              <input type="hidden" name="language" value="${language.id}">
              <input type="hidden" name="mode" value="${mode}">
              ${
                showAllCategories && includeOverall
                  ? ""
                  : `<input type="hidden" name="filtered" value="1">
                     ${includeOverall ? `<input type="hidden" name="overall" value="1">` : ""}
                     ${[...selectedCats].map((id) => `<input type="hidden" name="cats" value="${id}">`).join("")}`
              }
              <select class="select" name="measure" onchange="this.form.submit()" aria-label="Measure">
                ${Object.entries(MEASURES)
                  .map(
                    ([key, m]) =>
                      `<option value="${key}"${key === measure ? " selected" : ""}>${esc(m.label)}</option>`,
                  )
                  .join("")}
              </select>
            </form>
          </div>

          <div class="card-body chart-box" style="padding-top:14px">
            ${lineChart(series, { yLabel: MEASURES[measure].label })}
          </div>

          ${series.length > 0 ? legend(series.map((s) => ({ name: s.name, colour: s.colour }))) : ""}

          <form method="get" action="/progress" class="chart-filters">
            <input type="hidden" name="language" value="${language.id}">
            <input type="hidden" name="mode" value="${mode}">
            <input type="hidden" name="measure" value="${measure}">
            <!-- Marks the selection as deliberate, so unticking everything
                 means "show nothing" rather than falling back to "show all". -->
            <input type="hidden" name="filtered" value="1">

            <span class="chart-filters-label">Show</span>

            <label class="check">
              <input type="checkbox" name="overall" value="1" ${includeOverall ? "checked" : ""}
                     onchange="this.form.submit()"> All categories
            </label>

            ${types
              .map(
                (t) => `
              <label class="check">
                <input type="checkbox" name="cats" value="${t.wordTypeId}"
                       ${selectedCats.has(t.wordTypeId) ? "checked" : ""}
                       onchange="this.form.submit()"> ${esc(t.wordTypeName)}
                <span class="hint">${t.total}</span>
              </label>`,
              )
              .join("")}

            <a class="btn btn-sm btn-ghost"
               href="/progress?language=${language.id}&mode=${mode}&measure=${measure}">Reset</a>
          </form>
        </div>

        <!-- Today at a glance, both modes side by side. Separate from the
             30-day activity chart, which is about consistency over time. -->
        <div class="card">
          <div class="card-head">
            <div><h2>Today</h2>
              <div class="sub">${esc(todayStamp)} · <strong>${todayTotalTested}</strong> word${todayTotalTested === 1 ? "" : "s"} tested across both modes${
                todayTotalWords !== todayTotalTested
                  ? ` · ${todayTotalWords} different`
                  : ""
              }</div></div>
          </div>
          <div class="card-body">
            <div class="today-grid">
              ${todayCard("Written practice", icons.pen, todayWritten, "var(--accent)")}
              ${todayCard("Listening practice", icons.ear, todayAudio, "#2f7dc4")}
            </div>
          </div>
        </div>

        <!-- Where every word currently sits. These four sum to the total. -->
        <div class="card">
          <div class="card-head">
            <div><h2>Where your ${esc(language.name)} stands</h2>
              <div class="sub">${summary.total} words · ${summary.pctLearnt.toFixed(1)}% learnt</div></div>
          </div>
          <div class="card-body">
            <div class="split-bar">${splitBar}</div>
            <div class="split-legend">
              ${statusBands
                .map(
                  (b) => `
                <div class="split-item">
                  <i style="background:${b.colour}"></i>
                  <span class="split-count">${b.count}</span>
                  <span class="split-label">${esc(b.label)}</span>
                  <span class="hint">${((100 * b.count) / summary.total).toFixed(0)}%</span>
                </div>`,
                )
                .join("")}
            </div>
            <div class="hint" style="margin-top:12px">
              Solid is above ${(2.556).toFixed(3)}, learnt above ${(2.3).toFixed(1)}.
              Scores decay about 0.01 a day, so words move back down if left alone.
            </div>
          </div>
        </div>

        <div class="chart-grid">
          <div class="card">
            <div class="card-head"><div><h2>Completion by category</h2>
              <div class="sub">Where your vocabulary is strong and where it is thin.</div></div></div>
            <div class="card-body chart-box">
              ${barChart(types.map((t) => ({ label: t.wordTypeName, value: t.learnt, total: t.total })))}
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <div><h2>Practice activity</h2><div class="sub">Answers per day over the last 30 days.</div></div>
              <div class="row">
                <span class="pill pill-plain">${totalAnswers} answers</span>
                <span class="pill pill-plain">${activeDays} active days</span>
              </div>
            </div>
            <div class="card-body chart-box">${activityChart(days)}</div>
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-cell">
            <div class="value">${summary.total}</div><div class="label">Words</div>
          </div>
          <div class="summary-cell">
            <div class="value" style="color:var(--learnt)">${summary.pctLearnt.toFixed(1)}%</div>
            <div class="label">Learnt</div>
          </div>
          <div class="summary-cell">
            <div class="value">${summary.averageScore.toFixed(2)}</div>
            <div class="label">Avg score</div>
          </div>
          <div class="summary-cell">
            <div class="value">${summary.averageAccuracy.toFixed(0)}%</div>
            <div class="label">Avg accuracy</div>
          </div>
          <div class="summary-cell">
            <div class="value">${summary.staleDays}</div>
            <div class="label">Longest neglect</div>
          </div>
        </div>
      </div>`;

    return reply.type("text/html").send(layout(ctx, { title: "Progress", body }));
  });
}
