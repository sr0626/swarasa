"use client";

// "Insights" section of the location editor: anonymous engagement counters
// for this location (docs/API_CONTRACTS.md "Owner analytics"). Visible to the
// owner, assigned managers and admins — the same people who can open the
// editor; the API re-checks access on every read.
//
// Layout: range switcher (7/30/90 days) -> stat cards (each a button that
// picks which metric the chart shows) -> a plain-SVG bar series -> two
// non-period facts (followers, active deals). Every number is text; trends
// are worded ("Up 12% vs previous 30 days"), never colour or an arrow alone.
// Targets are 44px; the grid is 2 columns at 375px.
//
// Pure logic (period/gap-fill/percent/bars/labels) lives in
// lib/portal/analyticsView.ts. Ranges are fetched through a server action
// (the Cognito token stays server-side) and cached per range in state.
import { useCallback, useEffect, useState } from "react";
import { getLocationAnalyticsAction } from "@/app/portal/locations/[id]/actions";
import {
  ANALYTICS_RANGES,
  buildBars,
  chartAriaLabel,
  DEFAULT_RANGE,
  describeChange,
  fillSeriesGaps,
  formatShortDate,
  hasNoData,
  METRICS,
} from "@/lib/portal/analyticsView";
import type { AnalyticsRange, LocationAnalytics, MetricKey } from "@/types/analytics";

const CHART_W = 300;
const CHART_H = 80;

function trendGlyph(direction: string): string {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  return "•";
}

export default function LocationInsights({
  locationId,
  initial,
}: {
  locationId: number;
  /** The default (30-day) range loaded by the page; null if that load failed. */
  initial: LocationAnalytics | null;
}) {
  const [range, setRange] = useState<AnalyticsRange>(initial?.days ?? DEFAULT_RANGE);
  const [cache, setCache] = useState<Partial<Record<AnalyticsRange, LocationAnalytics>>>(
    initial ? { [initial.days]: initial } : {}
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("page_views");

  const load = useCallback(
    async (days: AnalyticsRange) => {
      setLoading(true);
      setError(null);
      const result = await getLocationAnalyticsAction(locationId, days);
      if (result.ok) {
        setCache((prev) => ({ ...prev, [days]: result.data }));
      } else {
        setError(result.error);
      }
      setLoading(false);
    },
    [locationId]
  );

  const data = cache[range];

  // Fetch the selected range when it isn't cached yet (including the first
  // load when the page-level load failed).
  useEffect(() => {
    if (!cache[range]) void load(range);
    // `cache` intentionally omitted: only a range change (or retry) should fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, load]);

  const selected = METRICS.find((m) => m.key === metric) ?? METRICS[0]!;

  return (
    <section
      aria-labelledby="insights-heading"
      aria-busy={loading}
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="insights-heading" className="font-display text-xl font-bold text-brand-ink">
        Insights
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Anonymous counts of how people found and used this listing. Nothing about individual visitors is
        recorded, and views by you, your managers and admins are not counted. Days are UTC.
      </p>

      <div role="group" aria-label="Time range" className="mt-4 flex flex-wrap gap-2">
        {ANALYTICS_RANGES.map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() => setRange(r)}
              className={
                "min-h-[44px] min-w-[44px] rounded-brand-pill border px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent " +
                (active
                  ? "border-brand-ink bg-brand-ink text-brand-bg"
                  : "border-brand-border bg-white text-brand-ink hover:bg-brand-chip")
              }
            >
              {r} days
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-4">
        {error && (
          <div role="alert" className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void load(range)}
              className="mt-2 inline-flex min-h-[44px] items-center rounded-brand-pill border border-brand-closed px-4 font-semibold"
            >
              Try again
            </button>
          </div>
        )}
        {!data && !error && <p className="text-sm text-brand-ink-muted">Loading insights&hellip;</p>}
      </div>

      {data && (
        <>
          {hasNoData(data.totals, data.previous_totals) && (
            <p className="mt-2 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-ink">
              No activity recorded yet. Counting started when this feature launched, so numbers build up
              from here as people visit your listing. Check back in a few days.
            </p>
          )}

          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {METRICS.map((m) => {
              const change = describeChange(data.totals[m.key], data.previous_totals[m.key], data.days);
              const active = m.key === metric;
              return (
                <li key={m.key}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMetric(m.key)}
                    className={
                      "flex min-h-[44px] w-full flex-col items-start rounded-brand-control border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent " +
                      (active ? "border-brand-ink bg-brand-chip" : "border-brand-border bg-white hover:bg-brand-chip")
                    }
                  >
                    <span className="text-xs font-semibold text-brand-ink-muted">{m.label}</span>
                    <span className="mt-0.5 font-display text-2xl font-bold text-brand-ink">
                      {data.totals[m.key].toLocaleString("en-US")}
                    </span>
                    <span className="mt-0.5 text-xs text-brand-ink-muted">
                      <span aria-hidden="true">{trendGlyph(change.direction)} </span>
                      {change.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <figure className="mt-5">
            <figcaption className="text-sm font-semibold text-brand-ink">
              {selected.label} per day
              <span className="font-normal text-brand-ink-muted"> &mdash; {selected.hint}</span>
            </figcaption>
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={chartAriaLabel(
                selected.label,
                fillSeriesGaps(data.series, data.start_date, data.days),
                metric
              )}
              className="mt-2 h-24 w-full text-brand-accent"
            >
              {buildBars(fillSeriesGaps(data.series, data.start_date, data.days), metric, CHART_W, CHART_H).map(
                (b) => (
                  <rect key={b.date} x={b.x} y={b.y} width={b.width} height={b.height} fill="currentColor" />
                )
              )}
            </svg>
            <div className="mt-1 flex justify-between text-xs text-brand-ink-muted">
              <span>{formatShortDate(data.start_date)}</span>
              <span>{formatShortDate(data.end_date)} (today)</span>
            </div>
          </figure>

          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-brand-control border border-brand-border p-3">
              <dt className="text-xs font-semibold text-brand-ink-muted">Followers</dt>
              <dd className="mt-0.5 font-display text-2xl font-bold text-brand-ink">
                {data.follower_count.toLocaleString("en-US")}
              </dd>
              <dd className="text-xs text-brand-ink-muted">Right now, for the whole restaurant</dd>
            </div>
            <div className="rounded-brand-control border border-brand-border p-3">
              <dt className="text-xs font-semibold text-brand-ink-muted">Active deals</dt>
              <dd className="mt-0.5 font-display text-2xl font-bold text-brand-ink">
                {data.active_deal_count.toLocaleString("en-US")}
              </dd>
              <dd className="text-xs text-brand-ink-muted">Switched on at this location</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
