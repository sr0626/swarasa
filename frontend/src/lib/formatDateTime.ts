// Shared date/time formatting for every place the app shows a backend
// timestamp (admin console reports, notifications, activity feeds, review
// queues, owner/manager consoles). Pure and dependency-free so it is unit
// tested with `node --test` (see formatDateTime.test.ts).
//
// WHY THIS EXISTS (admin "timestamp doesn't match" bug, 2026-09-24): pages
// such as the Registered users report are React Server Components, so the
// old inline `new Date(x).toLocaleString("en-US")` ran on the Amplify SERVER,
// whose timezone is UTC -- every admin saw UTC clock times with no label,
// hours off from their own clock. The fix has two halves:
//   1. every stored timestamp is UTC and the API always says so (`Z`); this
//      module additionally treats an offset-less string as UTC, never as
//      the viewer's local time (JS's own default for "2026-09-24T22:45:00");
//   2. formatting to the VIEWER's timezone happens in the browser
//      (`components/ui/LocalDateTime.tsx`), and the output always carries an
//      explicit zone label ("CDT"), so a UTC fallback can never be mistaken
//      for local time.

export type DateTimeVariant =
  /** "Sep 24, 2026, 10:45 PM CDT" */
  | "datetime"
  /** "Sep 24, 2026" (no zone label -- the calendar date in the given zone) */
  | "date"
  /** "Sep 24" */
  | "shortDate";

// "...Z", "...+05:30", "...-0500", "...+05" at the end of a string.
const HAS_ZONE = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Parses an API timestamp to a `Date`, or `null` if it is missing/invalid.
 * Strings WITHOUT an explicit zone are read as UTC (all stored timestamps
 * are UTC); strings with `Z`/an offset keep their true instant.
 */
export function parseInstant(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = value.trim();
  if (!text) return null;

  let normalized = text.replace(" ", "T");
  // Date-only ("2026-09-24") and time strings both need a zone to be UTC.
  const hasTime = normalized.includes("T");
  if (!hasTime) {
    normalized = `${normalized}T00:00:00Z`;
  } else if (!HAS_ZONE.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const OPTIONS: Record<DateTimeVariant, Intl.DateTimeFormatOptions> = {
  datetime: {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
  date: { year: "numeric", month: "short", day: "numeric" },
  shortDate: { month: "short", day: "numeric" },
};

/**
 * Formats an API timestamp in `timeZone` (an IANA name; default UTC so the
 * result is deterministic on a server). Returns `null` for a missing or
 * unparseable value -- callers choose their own fallback text.
 */
export function formatInstant(
  value: string | Date | null | undefined,
  options: { variant?: DateTimeVariant; timeZone?: string } = {}
): string | null {
  const date = parseInstant(value);
  if (!date) return null;
  const { variant = "datetime", timeZone = "UTC" } = options;
  try {
    return new Intl.DateTimeFormat("en-US", { ...OPTIONS[variant], timeZone }).format(date);
  } catch {
    // Unknown/invalid IANA zone name: fall back to UTC (still labelled).
    return new Intl.DateTimeFormat("en-US", { ...OPTIONS[variant], timeZone: "UTC" }).format(date);
  }
}

/** The viewer's IANA timezone (browser only); `undefined` where unavailable. */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
