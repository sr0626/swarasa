// Unit tests for the Insights view logic.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBars,
  chartAriaLabel,
  describeChange,
  fillSeriesGaps,
  formatShortDate,
  hasNoData,
  parseRange,
  percentChange,
  summarizeSeries,
} from "./analyticsView.ts";
import type { DailyPoint } from "../../types/analytics.ts";

function point(date: string, page_views = 0): DailyPoint {
  return {
    date,
    page_views,
    tile_clicks: 0,
    deal_views: 0,
    website_clicks: 0,
    directions_clicks: 0,
    phone_clicks: 0,
  };
}

test("parseRange accepts 7/30/90 as numbers or strings, else the fallback", () => {
  assert.equal(parseRange(7), 7);
  assert.equal(parseRange("90"), 90);
  assert.equal(parseRange("14"), 30);
  assert.equal(parseRange(undefined), 30);
  assert.equal(parseRange("abc", 7), 7);
});

test("fillSeriesGaps returns exactly `days` consecutive days, zero-filled, across a month end", () => {
  const filled = fillSeriesGaps([point("2026-10-31", 4), point("2026-11-02", 9)], "2026-10-30", 4);
  assert.deepEqual(
    filled.map((p) => p.date),
    ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]
  );
  assert.deepEqual(
    filled.map((p) => p.page_views),
    [0, 4, 0, 9]
  );
});

test("fillSeriesGaps ignores points outside the window", () => {
  const filled = fillSeriesGaps([point("2026-01-01", 5)], "2026-10-01", 2);
  assert.deepEqual(
    filled.map((p) => p.page_views),
    [0, 0]
  );
});

test("percentChange rounds to one decimal and is null without a baseline", () => {
  assert.equal(percentChange(15, 10), 50);
  assert.equal(percentChange(1, 3), -66.7);
  assert.equal(percentChange(5, 0), null);
});

test("describeChange gives a text label for every case (never colour only)", () => {
  assert.deepEqual(describeChange(15, 10, 30), { direction: "up", text: "Up 50% vs previous 30 days" });
  assert.deepEqual(describeChange(5, 10, 7), { direction: "down", text: "Down 50% vs previous 7 days" });
  assert.equal(describeChange(10, 10, 7).direction, "flat");
  assert.equal(describeChange(4, 0, 7).direction, "new");
  assert.deepEqual(describeChange(0, 0, 7), { direction: "none", text: "No activity yet" });
});

test("buildBars scales to the max, keeps non-zero days visible and zero days as a stub", () => {
  const series = [point("2026-10-01", 0), point("2026-10-02", 1), point("2026-10-03", 100)];
  const bars = buildBars(series, "page_views", 300, 50);
  assert.equal(bars.length, 3);
  assert.equal(bars[0]!.height, 1);
  assert.equal(bars[1]!.height, 2); // 1/100 of 50px is sub-pixel -> floor of 2px
  assert.equal(bars[2]!.height, 50);
  assert.equal(bars[2]!.y, 0);
  assert.ok(bars[1]!.x > bars[0]!.x);
  assert.deepEqual(buildBars([], "page_views", 300, 50), []);
  assert.ok(buildBars([point("2026-10-01")], "page_views", 300, 50).every((b) => b.height === 1));
});

test("summarizeSeries + chartAriaLabel describe total and busiest day in text", () => {
  const series = [point("2026-10-01", 2), point("2026-10-02", 7), point("2026-10-03", 1)];
  assert.deepEqual(summarizeSeries(series, "page_views"), { total: 10, peak: 7, peakDate: "2026-10-02" });
  assert.equal(
    chartAriaLabel("Page views", series, "page_views"),
    "Page views per day, last 3 days: 10 in total, busiest day Oct 2 with 7."
  );
  assert.equal(
    chartAriaLabel("Page views", [point("2026-10-01")], "page_views"),
    "Page views per day, last 1 days: none recorded."
  );
});

test("formatShortDate is timezone-independent", () => {
  assert.equal(formatShortDate("2026-01-05"), "Jan 5");
  assert.equal(formatShortDate("2026-12-31"), "Dec 31");
});

test("hasNoData is true only when both periods are all zero", () => {
  const zero = { page_views: 0, tile_clicks: 0, deal_views: 0, website_clicks: 0, directions_clicks: 0, phone_clicks: 0 };
  assert.equal(hasNoData(zero, zero), true);
  assert.equal(hasNoData({ ...zero, phone_clicks: 1 }, zero), false);
  assert.equal(hasNoData(zero, { ...zero, page_views: 1 }), false);
});
