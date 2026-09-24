// Unit tests for the deal display helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  dealPanelLabel,
  dealTypeHint,
  dealTypeLabel,
  formatDealDateRange,
  formatDealDays,
  formatNextOccurrence,
  restaurantDealsHref,
} from "./format.ts";

test("restaurantDealsHref points at the deals anchor on the restaurant page", () => {
  assert.equal(restaurantDealsHref("spice-garden-irving"), "/restaurant/spice-garden-irving#deals");
});

test("dealPanelLabel names the restaurant and lists titles, skipping blanks", () => {
  assert.equal(dealPanelLabel("Spice Garden", []), "Deal(s) available today at Spice Garden");
  assert.equal(
    dealPanelLabel("Spice Garden", ["Lunch buffet", "  ", "Kids eat free"]),
    "Deal(s) available today at Spice Garden: Lunch buffet, Kids eat free"
  );
});

test("formatDealDays: every day for null, empty and all seven", () => {
  assert.equal(formatDealDays(null), "Every day");
  assert.equal(formatDealDays(undefined), "Every day");
  assert.equal(formatDealDays([]), "Every day");
  assert.equal(formatDealDays([0, 1, 2, 3, 4, 5, 6]), "Every day");
});

test("formatDealDays: single day is plural", () => {
  assert.equal(formatDealDays([1]), "Tuesdays");
  assert.equal(formatDealDays([6]), "Sundays");
});

test("formatDealDays: two days, weekends special-case", () => {
  assert.equal(formatDealDays([1, 3]), "Tuesdays & Thursdays");
  assert.equal(formatDealDays([6, 5]), "Weekends");
});

test("formatDealDays: consecutive run of 3+ collapses to a range", () => {
  assert.equal(formatDealDays([0, 1, 2, 3, 4]), "Mon–Fri");
  assert.equal(formatDealDays([4, 5, 6]), "Fri–Sun");
});

test("formatDealDays: non-consecutive list, unordered and duplicated input", () => {
  assert.equal(formatDealDays([4, 0, 2, 0]), "Mon, Wed, Fri");
});

test("formatDealDays: ignores out-of-range values", () => {
  assert.equal(formatDealDays([9]), "Every day");
});

const TZ = "America/Chicago";

test("formatDealDateRange: whole-day window omits times, year on the end", () => {
  // Sep 25 00:00 CDT .. Oct 31 23:59 CDT
  const text = formatDealDateRange("2026-09-25T05:00:00Z", "2026-11-01T04:59:00Z", TZ);
  assert.equal(text, "Sep 25 – Oct 31, 2026");
});

test("formatDealDateRange: different years show both years", () => {
  const text = formatDealDateRange("2026-12-20T06:00:00Z", "2027-01-05T05:59:00Z", TZ);
  assert.equal(text, "Dec 20, 2026 – Jan 4, 2027");
});

test("formatDealDateRange: non-boundary times are shown", () => {
  // 5 PM CDT start, 9:30 PM CDT end
  const text = formatDealDateRange("2026-09-25T22:00:00Z", "2026-09-26T02:30:00Z", TZ);
  assert.equal(text, "Sep 25, 5 PM – Sep 25, 2026, 9:30 PM");
});

test("formatDealDateRange: no end date reads as Ongoing", () => {
  assert.equal(
    formatDealDateRange("2026-09-25T05:00:00Z", null, TZ),
    "From Sep 25, 2026 · Ongoing"
  );
});

test("formatDealDateRange: legacy rows (null start) still display", () => {
  assert.equal(formatDealDateRange(null, null, TZ), "Ongoing");
  assert.equal(formatDealDateRange(null, "2026-11-01T04:59:00Z", TZ), "Until Oct 31, 2026");
});

test("formatNextOccurrence: today, tomorrow, and a later date", () => {
  const now = new Date("2026-09-22T17:00:00Z"); // Tue noon in Chicago
  assert.equal(formatNextOccurrence("2026-09-22", { now, timeZone: TZ }), "Today");
  assert.equal(formatNextOccurrence("2026-09-23", { now, timeZone: TZ }), "Tomorrow");
  assert.equal(formatNextOccurrence("2026-09-29", { now, timeZone: TZ }), "Tue, Sep 29");
});

test("formatNextOccurrence: uses the location timezone for 'today'", () => {
  // 03:00 UTC on the 23rd is still the 22nd in Chicago.
  const now = new Date("2026-09-23T03:00:00Z");
  assert.equal(formatNextOccurrence("2026-09-22", { now, timeZone: TZ }), "Today");
});

test("formatNextOccurrence: passes through malformed input", () => {
  assert.equal(formatNextOccurrence("soon"), "soon");
});

test("dealTypeLabel: special -> Special, everything else -> Deal", () => {
  assert.equal(dealTypeLabel("special"), "Special");
  assert.equal(dealTypeLabel("deal"), "Deal");
  assert.equal(dealTypeLabel(undefined), "Deal");
  assert.equal(dealTypeLabel("nonsense"), "Deal");
});

test("dealTypeHint: ongoing -> Special, regardless of any leftover end value", () => {
  assert.equal(dealTypeHint(true, ""), "Will show as: Special (ongoing)");
  assert.equal(dealTypeHint(true, "2026-10-31T21:00"), "Will show as: Special (ongoing)");
});

test("dealTypeHint: an end date -> Deal with that date", () => {
  assert.equal(dealTypeHint(false, "2026-10-31T21:00"), "Will show as: Deal (ends Oct 31, 2026, 9 PM)");
  assert.equal(dealTypeHint(false, "2026-10-31T23:59"), "Will show as: Deal (ends Oct 31, 2026)");
});

test("dealTypeHint: not ongoing but no (valid) end date yet -> Deal, prompting for one", () => {
  const prompt = "Will show as: Deal (once you set an end date)";
  assert.equal(dealTypeHint(false, ""), prompt);
  assert.equal(dealTypeHint(false, null), prompt);
  assert.equal(dealTypeHint(false, "not a date"), prompt);
});
