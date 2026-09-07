import { and, eq, gte, sql } from "drizzle-orm";
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
];

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
    const query = request.query as Record<string, string | undefined>;
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

    /* ---- Words learnt over time, per category ---- */

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
          eq(statSnapshots.measure, "percentage_learnt"),
        ),
      )
      .orderBy(statSnapshots.takenAt)
      .all();

    const typeNames = new Map(types.map((t) => [t.wordTypeId, t.wordTypeName]));
    const grouped = new Map<string, { x: number; y: number }[]>();

    for (const row of history) {
      const key =
        row.wordTypeId === null
          ? "All categories"
          : (typeNames.get(row.wordTypeId) ?? "Removed category");
      const bucket = grouped.get(key) ?? [];
      bucket.push({ x: Date.parse(row.takenAt), y: row.value });
      grouped.set(key, bucket);
    }

    const series: Series[] = [...grouped.entries()]
      // "All categories" first so it takes the accent colour.
      .sort((a, b) => (a[0] === "All categories" ? -1 : b[0] === "All categories" ? 1 : 0))
      .slice(0, 6)
      .map(([name, points], i) => ({
        name,
        colour: SERIES_COLOURS[i % SERIES_COLOURS.length]!,
        points,
      }));

    /* ---- Answers per day, last 30 days ---- */

    const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

    const activityRows = db
      .select({
        day: sql<string>`substr(${attempts.answeredAt}, 1, 10)`,
        count: sql<number>`count(*)`,
      })
      .from(attempts)
      .innerJoin(words, eq(words.id, attempts.wordId))
      .innerJoin(wordTypes, eq(wordTypes.id, words.wordTypeId))
      .where(
        and(
          eq(wordTypes.languageId, language.id),
          eq(attempts.mode, mode),
          gte(sql`substr(${attempts.answeredAt}, 1, 10)`, since),
        ),
      )
      .groupBy(sql`substr(${attempts.answeredAt}, 1, 10)`)
      .all();

    const activityMap = new Map(activityRows.map((r) => [r.day, r.count]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, count: activityMap.get(date) ?? 0 };
    });

    const totalAnswers = days.reduce((sum, d) => sum + d.count, 0);
    const activeDays = days.filter((d) => d.count > 0).length;

    /* ---- Weakest words ---- */

    const weakest = [...scored]
      .filter((w) => Object.keys(w.directions).length > 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8);

    const body = `
      ${pageHead({
        title: "Progress",
        sub: `How much of your ${esc(language.name)} is holding, and where the gaps are.`,
        actions: `
          <a class="btn${mode === "written" ? " btn-primary" : ""}" href="/progress?language=${language.id}&mode=written">Written</a>
          <a class="btn${mode === "audio" ? " btn-primary" : ""}" href="/progress?language=${language.id}&mode=audio">Listening</a>`,
      })}

      <div class="stack">
        <div class="summary-grid">
          <div class="summary-cell">
            <div class="value">${summary.total}</div><div class="label">Words</div>
          </div>
          <div class="summary-cell">
            <div class="value" style="color:var(--learnt)">${summary.pctLearnt.toFixed(1)}%</div>
            <div class="label">Learnt</div>
          </div>
          <div class="summary-cell">
            <div class="value" style="color:var(--learnt)">${summary.completelyLearnt}</div>
            <div class="label">Solid</div>
          </div>
          <div class="summary-cell">
            <div class="value" style="color:var(--learning)">${summary.inProgress}</div>
            <div class="label">Learning</div>
          </div>
          <div class="summary-cell">
            <div class="value" style="color:var(--new)">${summary.untouched}</div>
            <div class="label">Untouched</div>
          </div>
          <div class="summary-cell">
            <div class="value">${summary.averageScore.toFixed(2)}</div>
            <div class="label">Avg score</div>
          </div>
        </div>

        <div class="chart-grid">
          <div class="card">
            <div class="card-head"><div><h2>Percentage learnt over time</h2>
              <div class="sub">Recorded at the start and end of every session.</div></div></div>
            <div class="card-body chart-box">${lineChart(series, { yLabel: "Percent learnt" })}</div>
            ${series.length > 0 ? legend(series.map((s) => ({ name: s.name, colour: s.colour }))) : ""}
          </div>

          <div class="card">
            <div class="card-head"><div><h2>Completion by category</h2>
              <div class="sub">Where your vocabulary is strong and where it is thin.</div></div></div>
            <div class="card-body chart-box">
              ${barChart(types.map((t) => ({ label: t.wordTypeName, value: t.learnt, total: t.total })))}
            </div>
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

        <div class="card">
          <div class="card-head"><div><h2>Needs the most work</h2>
            <div class="sub">Lowest-scoring words you have already seen at least once.</div></div></div>
          ${
            weakest.length === 0
              ? `<div class="empty" style="padding:34px"><p>Nothing practised yet — do a session and the weak spots show up here.</p></div>`
              : `<div class="table-wrap"><table class="data">
                  <thead><tr><th>Word</th><th>English</th><th class="col-type">Category</th><th class="num">Score</th><th class="col-seen">Last seen</th></tr></thead>
                  <tbody>
                    ${weakest
                      .map(
                        (w) => `<tr>
                          <td class="term">${esc(w.term)}</td>
                          <td>${esc(w.english)}</td>
                          <td class="col-type"><span class="pill pill-plain">${esc(w.wordTypeName)}</span></td>
                          <td class="num">${w.score.toFixed(2)}</td>
                          <td class="hint col-seen">${w.lastTested ? esc(w.lastTested) : "never"}</td>
                        </tr>`,
                      )
                      .join("")}
                  </tbody>
                </table></div>`
          }
        </div>
      </div>`;

    return reply.type("text/html").send(layout(ctx, { title: "Progress", body }));
  });
}
