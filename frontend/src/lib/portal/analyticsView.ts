// Pure logic behind the location editor's "Insights" section
// (components/portal/LocationInsights.tsx): range options, series gap-filling,
// percentage change + its plain-text label, bar-chart geometry and the
// screen-reader summary. No React, no `next/*` — unit-tested in
// analyticsView.test.ts. All dates are UTC calendar dates (`YYYY-MM-DD`),
// matching the API (docs/API_CONTRACTS.md "Owner analytics").
import type { AnalyticsRange, DailyPoint, MetricKey } from "@/types/analytics";

export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [7, 30, 90];
export const DEFAULT_RANGE: AnalyticsRange = 30;

export const METRICS: readonly { key: MetricKey; label: string; hint: string }[] = [
  { key: "page_views", label: "Page views", hint: "Times your listing page was opened" },
  { key: "tile_clicks", label: "Search clicks", hint: "Clicks on your tile in search and home lists" },
  { key: "deal_views", label: "Deal views", hint: "Times the deals section was seen" },
  { key: "directions_clicks", label: "Directions", hint: "Clicks on the address or Get directions" },
  { key: "phone_clicks", label: "Phone taps", hint: "Clicks on your phone number" },
  { key: "website_clicks", label: "Website clicks", hint: "Clicks on your website link" },
];

export function parseRange(value: unknown, fallback: AnalyticsRange = DEFAULT_RANGE): AnalyticsRange {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return ANALYTICS_RANGES.find((r) => r === n) ?? fallback;
}

const DAY_MS = 86_400_000;

function parseUtcDate(date: string): number {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const EMPTY_COUNTS: Omit<DailyPoint, "date"> = {
  page_views: 0,
  tile_clicks: 0,
  deal_views: 0,
  website_clicks: 0,
  directions_clicks: 0,
  phone_clicks: 0,
};

/**
 * Exactly `days` consecutive daily points starting at `startDate`, taking
 * counts from `series` by date and zero-filling any missing day. The API
 * already sends a dense series; this keeps the chart correct (and the
 * x-axis honest) if a day is ever absent.
 */
export function fillSeriesGaps(series: readonly DailyPoint[], startDate: string, days: number): DailyPoint[] {
  const byDate = new Map(series.map((p) => [p.date, p]));
  const start = parseUtcDate(startDate);
  const out: DailyPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = formatUtcDate(start + i * DAY_MS);
    out.push(byDate.get(date) ?? { date, ...EMPTY_COUNTS });
  }
  return out;
}

/** Percent change from `previous` to `current`, 1 decimal; null when `previous` is 0. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) * 1000) / previous) / 10;
}

export type ChangeDirection = "up" | "down" | "flat" | "new" | "none";

export interface ChangeLabel {
  direction: ChangeDirection;
  /** Plain text, so the trend never relies on colour or an arrow alone. */
  text: string;
}

/** "Up 12.5% vs previous 30 days" / "Down 5% ..." / "No change ..." / "New: no activity in the previous 30 days" / "No activity yet". */
export function describeChange(current: number, previous: number, days: number): ChangeLabel {
  const period = `previous ${days} days`;
  if (previous <= 0) {
    return current > 0
      ? { direction: "new", text: `New: none in the ${period}` }
      : { direction: "none", text: "No activity yet" };
  }
  const pct = percentChange(current, previous) ?? 0;
  if (pct === 0) return { direction: "flat", text: `No change vs ${period}` };
  const magnitude = Math.abs(pct);
  return pct > 0
    ? { direction: "up", text: `Up ${magnitude}% vs ${period}` }
    : { direction: "down", text: `Down ${magnitude}% vs ${period}` };
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  date: string;
}

/**
 * Bar geometry for an SVG of `width` x `height` (y grows downward). Bars are
 * scaled to the series maximum; a non-zero day always gets at least 2px so it
 * stays visible; a zero day gets a 1px baseline stub so the day still reads
 * as "present, none".
 */
export function buildBars(
  series: readonly DailyPoint[],
  metric: MetricKey,
  width: number,
  height: number,
  gap = 1
): Bar[] {
  const n = series.length;
  if (n === 0) return [];
  const max = Math.max(0, ...series.map((p) => p[metric]));
  const slot = width / n;
  const barWidth = Math.max(1, slot - gap);
  return series.map((p, i) => {
    const value = p[metric];
    const h = value === 0 || max === 0 ? 1 : Math.max(2, (value / max) * height);
    return { x: i * slot + gap / 2, y: height - h, width: barWidth, height: h, value, date: p.date };
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-03" -> "Oct 3" (UTC date, no timezone shifting). */
export function formatShortDate(date: string): string {
  const d = new Date(parseUtcDate(date));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export interface SeriesSummary {
  total: number;
  peak: number;
  peakDate: string | null;
}

export function summarizeSeries(series: readonly DailyPoint[], metric: MetricKey): SeriesSummary {
  let total = 0;
  let peak = 0;
  let peakDate: string | null = null;
  for (const p of series) {
    total += p[metric];
    if (p[metric] > peak) {
      peak = p[metric];
      peakDate = p.date;
    }
  }
  return { total, peak, peakDate };
}

/** Screen-reader text for the chart `role="img"`. */
export function chartAriaLabel(label: string, series: readonly DailyPoint[], metric: MetricKey): string {
  const { total, peak, peakDate } = summarizeSeries(series, metric);
  const days = series.length;
  if (total === 0) return `${label} per day, last ${days} days: none recorded.`;
  return `${label} per day, last ${days} days: ${total} in total, busiest day ${formatShortDate(peakDate as string)} with ${peak}.`;
}

/** True when nothing has been counted in the loaded window or the one before it. */
export function hasNoData(
  totals: Record<MetricKey, number>,
  previousTotals: Record<MetricKey, number>
): boolean {
  return METRICS.every((m) => totals[m.key] === 0 && previousTotals[m.key] === 0);
}
