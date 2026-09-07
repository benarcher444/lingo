import { esc } from "./layout.js";

/**
 * Hand-rolled inline SVG charts. No charting library: it keeps the page working
 * with no network (the Pi may have none), and there is no bundle to build.
 *
 * Colours come from CSS custom properties so both themes are handled by the
 * stylesheet rather than duplicated here.
 */

export interface Series {
  name: string;
  colour: string;
  points: { x: number; y: number }[];
}

const W = 560;
const H = 220;
const PAD = { top: 14, right: 14, bottom: 26, left: 38 };

export interface Threshold {
  value: number;
  label: string;
  colour: string;
}

export function lineChart(
  series: Series[],
  opts: { yLabel?: string; thresholds?: Threshold[] } = {},
): string {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return emptyChart("Not enough history yet");

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = 0;
  // Leave headroom for a threshold line sitting above every plotted point.
  const thresholdMax = Math.max(0, ...(opts.thresholds ?? []).map((t) => t.value));
  const maxY = Math.max(...ys, thresholdMax * 1.1, 1);

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const px = (x: number) =>
    PAD.left + ((x - minX) / spanX) * (W - PAD.left - PAD.right);
  const py = (y: number) =>
    H - PAD.bottom - ((y - minY) / spanY) * (H - PAD.top - PAD.bottom);

  const ticks = 4;
  const gridLines = Array.from({ length: ticks + 1 }, (_, i) => {
    const value = minY + (spanY * i) / ticks;
    const y = py(value);
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}"
              stroke="var(--border)" stroke-width="1" />
            <text x="${PAD.left - 7}" y="${(y + 3.5).toFixed(1)}" text-anchor="end"
              font-size="13" fill="var(--text-faint)">${formatTick(value)}</text>`;
  }).join("");

  const paths = series
    .map((s) => {
      if (s.points.length === 0) return "";
      const sorted = [...s.points].sort((a, b) => a.x - b.x);
      const d = sorted
        .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`)
        .join(" ");

      const last = sorted[sorted.length - 1]!;

      return `<path d="${d}" fill="none" stroke="${s.colour}" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round" />
              <circle cx="${px(last.x).toFixed(1)}" cy="${py(last.y).toFixed(1)}" r="3"
                fill="${s.colour}" />`;
    })
    .join("");

  const dateLabels = [minX, maxX]
    .map((x, i) => {
      const label = new Date(x).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      });
      return `<text x="${px(x).toFixed(1)}" y="${H - 7}" font-size="13"
                text-anchor="${i === 0 ? "start" : "end"}" fill="var(--text-faint)">${esc(label)}</text>`;
    })
    .join("");

  const thresholdLines = (opts.thresholds ?? [])
    .filter((t) => t.value <= maxY)
    .map((t, i) => {
      const y = py(t.value);
      // Alternate sides: two thresholds close together (learnt at 2.3, solid at
      // 2.556) would otherwise print their labels on top of each other.
      const onLeft = i % 2 === 1;
      const x = onLeft ? PAD.left + 3 : W - PAD.right - 3;

      return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}"
                stroke="${t.colour}" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.8" />
              <text x="${x}" y="${(y - 5).toFixed(1)}" text-anchor="${onLeft ? "start" : "end"}"
                font-size="12" fill="${t.colour}">${esc(t.label)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.yLabel ?? "Chart")} over time">
    ${gridLines}${thresholdLines}${paths}${dateLabels}
  </svg>`;
}

export function barChart(
  rows: { label: string; value: number; total: number }[],
): string {
  if (rows.length === 0) return emptyChart("No categories yet");

  const rowH = 32;
  const height = rows.length * rowH + 8;
  // labelX inset: the text used to start at x=0, flush against the card border.
  const labelX = 10;
  const labelW = 150;
  const barW = W - labelW - 66;

  const bars = rows
    .map((row, i) => {
      const y = i * rowH + 6;
      const pct = row.total > 0 ? (row.value / row.total) * 100 : 0;
      const w = (pct / 100) * barW;

      return `
        <text x="${labelX}" y="${y + 13}" font-size="14" fill="var(--text-muted)">${esc(truncate(row.label, 15))}</text>
        <rect x="${labelW}" y="${y + 3}" width="${barW}" height="13" rx="6.5" fill="var(--surface-sunken)" />
        <rect x="${labelW}" y="${y + 3}" width="${Math.max(0, w).toFixed(1)}" height="13" rx="6.5" fill="var(--learnt)" />
        <text x="${labelW + barW + 9}" y="${y + 13}" font-size="13" fill="var(--text-faint)"
          font-variant-numeric="tabular-nums">${pct.toFixed(0)}%</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Completion by category">${bars}</svg>`;
}

export function activityChart(days: { date: string; count: number }[]): string {
  if (days.length === 0) return emptyChart("No practice recorded yet");

  const max = Math.max(...days.map((d) => d.count), 1);
  const height = 130;
  const gap = 3;
  const barW = Math.max(3, (W - (days.length - 1) * gap) / days.length);

  const bars = days
    .map((day, i) => {
      const h = Math.max(2, (day.count / max) * (height - 28));
      const x = i * (barW + gap);
      const y = height - 20 - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}"
                height="${h.toFixed(1)}" rx="2" fill="var(--accent)" opacity="${day.count > 0 ? 1 : 0.25}">
                <title>${esc(day.date)}: ${day.count} answers</title>
              </rect>`;
    })
    .join("");

  const first = days[0]?.date ?? "";
  const last = days[days.length - 1]?.date ?? "";

  return `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Answers per day">
    ${bars}
    <text x="0" y="${height - 4}" font-size="13" fill="var(--text-faint)">${esc(shortDate(first))}</text>
    <text x="${W}" y="${height - 4}" font-size="13" text-anchor="end" fill="var(--text-faint)">${esc(shortDate(last))}</text>
  </svg>`;
}

export function legend(items: { name: string; colour: string }[]): string {
  return `<div class="legend">${items
    .map(
      (i) =>
        `<span><i style="background:${i.colour}"></i>${esc(i.name)}</span>`,
    )
    .join("")}</div>`;
}

function emptyChart(message: string): string {
  return `<div class="empty" style="padding:36px 20px">
    <p>${esc(message)}</p>
  </div>`;
}

function formatTick(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shortDate(iso: string): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
