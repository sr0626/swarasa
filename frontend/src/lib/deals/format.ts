// Display helpers for deals — shared by the public "More deals & specials"
// list (RestaurantUpcomingDeals) and the owner's management cards
// (LocationDealsManager). Pure functions, no React, so they're unit-tested
// with `node --test` (format.test.ts).
//
// Day numbers follow the API: 0=Monday..6=Sunday (same as
// `restaurant_hours.day_of_week`).

const DAY_ABBREVIATIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_PLURALS = [
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
  "Sundays",
];

/**
 * Human-readable "which days" label.
 *   null / [] / all seven  -> "Every day"
 *   [1]                    -> "Tuesdays"
 *   [1, 3]                 -> "Tuesdays & Thursdays"
 *   [5, 6]                 -> "Weekends"
 *   [0..4] (3+ in a row)   -> "Mon–Fri"
 *   anything else          -> "Mon, Wed, Sat"
 * Input order and duplicates don't matter.
 */
export function formatDealDays(days: readonly number[] | null | undefined): string {
  if (!days || days.length === 0) return "Every day";
  const sorted = Array.from(new Set(days))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  if (sorted.length === 0 || sorted.length === 7) return "Every day";
  const plural = (d: number): string => DAY_PLURALS[d] ?? "";
  const abbr = (d: number): string => DAY_ABBREVIATIONS[d] ?? "";
  const first = sorted[0] ?? 0;
  const last = sorted[sorted.length - 1] ?? first;
  if (sorted.length === 1) return plural(first);
  if (sorted.length === 2) {
    if (first === 5 && last === 6) return "Weekends";
    return `${plural(first)} & ${plural(last)}`;
  }
  const consecutive = last - first === sorted.length - 1;
  if (consecutive) return `${abbr(first)}–${abbr(last)}`;
  return sorted.map(abbr).join(", ");
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(date: Date, timeZone?: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h12} ${suffix}` : `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * One end of a deal's window as "Sep 25" / "Sep 25, 2026", plus the time of
 * day ONLY when it isn't a "whole day" boundary (start 12:00 AM, end 11:59 PM
 * or 12:00 AM) — most deals are whole-day windows, so "Sep 25, 12:00 AM"
 * would just be noise.
 */
function formatBoundary(
  iso: string,
  kind: "start" | "end",
  timeZone: string | undefined,
  includeYear: boolean
): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = localParts(date, timeZone);
  let text = `${MONTHS[p.month - 1]} ${p.day}`;
  if (includeYear) text += `, ${p.year}`;
  const wholeDay =
    kind === "start"
      ? p.hour === 0 && p.minute === 0
      : (p.hour === 23 && p.minute === 59) || (p.hour === 0 && p.minute === 0);
  if (!wholeDay) text += `, ${formatTime(p.hour, p.minute)}`;
  return text;
}

/**
 * A deal's date window for display.
 *   start + end   -> "Sep 25 – Oct 31, 2026" (year shown on the end, and on
 *                    the start too when the years differ)
 *   start, no end -> "From Sep 25, 2026 · Ongoing"
 *   no start, end -> "Until Oct 31, 2026"       (legacy rows)
 *   neither       -> "Ongoing"                  (legacy rows)
 * `timeZone` is an IANA name (the location's, for the public list); omit it
 * to use the runtime's own zone (the owner's own browser, matching what
 * they typed into the form).
 */
export function formatDealDateRange(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  timeZone?: string
): string {
  const startParts = startAt ? new Date(startAt) : null;
  const endParts = endAt ? new Date(endAt) : null;
  const startOk = startParts && !Number.isNaN(startParts.getTime());
  const endOk = endParts && !Number.isNaN(endParts.getTime());

  if (startOk && endOk) {
    const sameYear = localParts(startParts, timeZone).year === localParts(endParts, timeZone).year;
    const start = formatBoundary(startAt as string, "start", timeZone, !sameYear);
    const end = formatBoundary(endAt as string, "end", timeZone, true);
    return `${start} – ${end}`;
  }
  if (startOk) {
    return `From ${formatBoundary(startAt as string, "start", timeZone, true)} · Ongoing`;
  }
  if (endOk) {
    return `Until ${formatBoundary(endAt as string, "end", timeZone, true)}`;
  }
  return "Ongoing";
}

/** Restaurant page anchor of the "Today's deals" section (RestaurantDeals). */
export const DEALS_SECTION_ID = "deals";

/** `/restaurant/{brandSlug}/{locationSlug}#deals` — where a deal badge on a tile goes: the
 * deals section of THAT location's page (deals are per location). */
export function restaurantDealsHref(brandSlug: string, locationSlug: string): string {
  return `/restaurant/${brandSlug}/${locationSlug}#${DEALS_SECTION_ID}`;
}

/**
 * Accessible name for the favourites-tile deal panel link, e.g.
 * "Deal(s) available today at Spice Garden: Lunch buffet, Kids eat free".
 * Blank titles are ignored.
 */
export function dealPanelLabel(name: string, titles: readonly string[]): string {
  const clean = titles.map((t) => t.trim()).filter((t) => t.length > 0);
  const base = `Deal(s) available today at ${name}`;
  return clean.length > 0 ? `${base}: ${clean.join(", ")}` : base;
}

/**
 * "YYYY-MM-DD" (a calendar date in the location's timezone, as sent in
 * `next_occurrence`) -> "Today" / "Tomorrow" / "Tue, Sep 29". `now` and
 * `timeZone` only decide the Today/Tomorrow wording; the date text itself is
 * formatted without any timezone conversion, so it can never shift a day.
 */
export function formatNextOccurrence(
  isoDate: string,
  opts: { now?: Date; timeZone?: string } = {}
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, y, m, d] = match;
  const target = Date.UTC(Number(y), Number(m) - 1, Number(d));

  const today = localParts(opts.now ?? new Date(), opts.timeZone);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  const diffDays = Math.round((target - todayUtc) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";

  const date = new Date(target);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  return `${weekday}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

// ---- Deal vs Special: derived from the end date ---------------------------
//
// The label is NOT chosen by the owner (2026-09-24 decision): no end date
// (ongoing) -> "special", has an end date -> "deal". The API's `deal_type`
// always reflects this (backend `effective_deal_type`); these helpers only
// present it, and drive the owner form's live "Will show as" hint.

/** Badge text for an API `deal_type` ("Deal" / "Special"). Unknown values
 * fall back to "Deal" rather than leaking the raw string. */
export function dealTypeLabel(dealType: string | null | undefined): string {
  return dealType === "special" ? "Special" : "Deal";
}

/**
 * Live owner-form hint. `endLocal` is the `<input type="datetime-local">`
 * value ("YYYY-MM-DDTHH:MM", browser-local, or ""); `ongoing` is the
 * "Ongoing (no end date)" checkbox.
 *   ongoing                     -> "Will show as: Special (ongoing)"
 *   not ongoing, valid end date -> "Will show as: Deal (ends Oct 31, 2026)"
 *   not ongoing, no end yet     -> "Will show as: Deal (once you set an end date)"
 */
export function dealTypeHint(ongoing: boolean, endLocal: string | null | undefined): string {
  if (ongoing) return "Will show as: Special (ongoing)";
  if (endLocal) {
    const parsed = new Date(endLocal);
    if (!Number.isNaN(parsed.getTime())) {
      const end = formatBoundary(parsed.toISOString(), "end", undefined, true);
      if (end) return `Will show as: Deal (ends ${end})`;
    }
  }
  return "Will show as: Deal (once you set an end date)";
}
