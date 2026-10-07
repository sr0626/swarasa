// Date/time formatting shared by <LocalDateTime>. Two formats:
//  - `formatUtcDateTime`: deterministic (same string on the server and in the
//    browser), used for the server render and the first client render so
//    hydration never mismatches.
//  - `formatLocalDateTime`: the viewer's own timezone, applied after mount.
const OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** "Oct 7, 2026, 3:05 PM UTC" — or the raw input when it isn't a valid date. */
export function formatUtcDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleString("en-US", { ...OPTIONS, timeZone: "UTC" })} UTC`;
}

/** Same layout in the viewer's local timezone; raw input when invalid. */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", OPTIONS);
}
