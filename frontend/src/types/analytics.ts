// Owner analytics (anonymous per-location daily counters) — matches
// backend/app/schemas/analytics.py; docs/API_CONTRACTS.md "Owner analytics".

/** Events the public pages report (best-effort beacons). */
export type TrackEvent =
  | "page_view"
  | "tile_click"
  | "deal_view"
  | "website_click"
  | "directions_click"
  | "phone_click";

/** Body of the same-origin relay `POST /api/track`. */
export interface TrackEventInput {
  location_id: number;
  event: TrackEvent;
}

export type MetricKey =
  | "page_views"
  | "tile_clicks"
  | "deal_views"
  | "website_clicks"
  | "directions_clicks"
  | "phone_clicks";

export type MetricTotals = Record<MetricKey, number>;
export type MetricChange = Record<MetricKey, number | null>;

export interface DailyPoint extends MetricTotals {
  /** UTC calendar date, `YYYY-MM-DD`. */
  date: string;
}

export type AnalyticsRange = 7 | 30 | 90;

export interface LocationAnalytics {
  location_id: number;
  days: AnalyticsRange;
  start_date: string;
  end_date: string;
  timezone: string;
  series: DailyPoint[];
  totals: MetricTotals;
  previous_totals: MetricTotals;
  change_pct: MetricChange;
  /** First day with any data; null = nothing recorded yet. */
  data_since: string | null;
  /** Brand-level (every location of a brand shows the same number). */
  follower_count: number;
  active_deal_count: number;
}
