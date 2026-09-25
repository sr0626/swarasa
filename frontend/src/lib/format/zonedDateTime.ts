// Date-time in an explicit IANA timezone WITH its label ("Sep 24, 2026, 10:45 PM
// CDT"). Pure — used by the owner/manager activity feed. Formatting in the
// location's timezone (not the runtime's) keeps the server-rendered first page
// and the client-rendered "Load more" rows identical (the Lambda runs in UTC;
// a browser runs wherever the visitor is) and always shows which zone it is.

const FALLBACK_TIMEZONE = "America/Chicago";

function format(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return null;
  }
}

/**
 * `formatZonedDateTime("2026-09-25T03:45:00Z", "America/Chicago")` ->
 * `"Sep 24, 2026, 10:45 PM CDT"`. An unusable timezone falls back to
 * `America/Chicago` (the platform default), then to UTC; an unparseable date
 * is returned unchanged.
 */
export function formatZonedDateTime(iso: string, timeZone: string | null | undefined): string {
  return (
    format(iso, timeZone || FALLBACK_TIMEZONE) ??
    format(iso, FALLBACK_TIMEZONE) ??
    format(iso, "UTC") ??
    iso
  );
}
