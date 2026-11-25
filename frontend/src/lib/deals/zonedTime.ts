// Wall-clock <-> instant conversion in a NAMED time zone (the restaurant's),
// for the deal form's `<input type="datetime-local">` fields.
//
// A datetime-local value ("YYYY-MM-DDTHH:MM") carries no zone. It must never
// be handed to `new Date()` on its own: the result then depends on whichever
// machine runs it (browser vs. UTC server), which is how deal times were
// saved hours early. Deal times always mean "time at the restaurant".

// Same fallback as `DEFAULT_TIMEZONE` (lib/timezone.ts) and the backend's
// `hours_service.safe_zone`. Declared here so this file has no imports and
// runs directly under the node test runner.
const DEFAULT_TIMEZONE = "America/Chicago";

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const DAY_MS = 86_400_000;

/** `timeZone` if the runtime knows it, else the backend's own fallback
 * (`hours_service.safe_zone`). */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** The wall clock `timeZone` shows at `instant`, expressed as if it were UTC. */
function wallClockAsUtc(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
}

/**
 * "YYYY-MM-DDTHH:MM" at the restaurant -> ISO instant, or null when the value
 * isn't a real date and time. Around a clock change: a time that happens
 * twice takes the earlier one; a time that is skipped moves forward by the
 * size of the jump.
 */
export function wallClockToIso(value: string, timeZone: string): string | null {
  const match = WALL_CLOCK.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  // Reject roll-overs such as 2026-02-30 or 24:00.
  const check = new Date(wanted);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || mi > 59) {
    return null;
  }
  const zone = safeTimeZone(timeZone);
  // The offsets in force a day before and a day after cover any transition.
  const offsetAt = (instant: number): number => wallClockAsUtc(instant, zone) - instant;
  const before = offsetAt(wanted - DAY_MS);
  const after = offsetAt(wanted + DAY_MS);
  const exact = [wanted - before, wanted - after].filter((t) => wallClockAsUtc(t, zone) === wanted);
  const instant = exact.length > 0 ? Math.min(...exact) : wanted - before;
  return new Date(instant).toISOString();
}

/** ISO instant -> "YYYY-MM-DDTHH:MM" at the restaurant ("" when empty/invalid). */
export function isoToWallClock(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const instant = new Date(iso).getTime();
  if (Number.isNaN(instant)) return "";
  return new Date(wallClockAsUtc(instant, safeTimeZone(timeZone))).toISOString().slice(0, 16);
}

/** What the deal form sends for one date box: the instant when the value is a
 * valid wall-clock time, otherwise the raw value so validation reports it. */
export function toApiDateTime(value: string, timeZone: string): string {
  return wallClockToIso(value, timeZone) ?? value;
}
