// Owner/manager console-only "what does this tile say about hours right
// now" logic (LocationStatusChip, components/console/LocationStatusChip.tsx).
//
// Deliberately separate from lib/formatHours.ts's `describeTodayHours`,
// which backs the PUBLIC search/listing "Open today 11am-9pm" label and has
// its own settled history of never showing a placeholder when hours are
// unknown (see components/ui/OpenStatusBadge.tsx's header comment — public
// pages have "deliberate 'no Open today Xam-Ypm label' history"). The
// owner/manager console has a different job: an owner/manager looking at
// their OWN tile needs an actionable answer, not silence, so here
// "hours unknown" and "closed all day" both collapse to an explicit
// "Closed today" rather than rendering nothing. Scope is owner/manager
// console tiles ONLY — never wire this into the public RestaurantCard /
// OpenStatusBadge path.
import { todayIndexInTimezone } from "@/lib/formatHours";
import type { LocationHour } from "@/types/location";

export type ConsoleTodayStatus =
  | { kind: "open_now" }
  | { kind: "opens_at"; time: string }
  /** Genuinely closed for the ENTIRE day — no hours row, "hours unknown"
   * (is_closed: null), or is_closed: true. */
  | { kind: "closed_today" }
  /** Has hours today, but "now" is already past close_time — the location
   * WAS open today and no longer is, distinct from never having opened.
   * Split out from `closed_today` per direct user feedback 2026-09-23. */
  | { kind: "closed_now" }
  /** Can't tell (no timezone, unresolvable timezone, etc.) — caller renders
   * nothing extra rather than guessing. */
  | { kind: "unknown" };

/**
 * "11:00:00" -> "11:00 AM" — always minute-padded with a spaced AM/PM,
 * unlike formatHours.ts's compact `formatShortTime` ("11am") used on public
 * pages. Kept local to this file since the console wording ("Opens at
 * 11:00 AM") is its own requirement, not a shared format.
 */
function formatClockTime(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const hour = Number.parseInt(hourStr ?? "", 10);
  const minute = Number.parseInt(minuteStr ?? "0", 10);
  if (Number.isNaN(hour)) return time;
  const period = hour >= 12 && hour < 24 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "HH:MM:SS" current time-of-day in a timezone, zero-padded so it can be
 * compared lexically against an `open_time` string. `null` if the timezone
 * can't be resolved. */
function currentTimeOfDay(timeZone: string, now: Date): string | null {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
    // Some ICU implementations print midnight as "24:00:00" under
    // hour12:false — normalize so the string compare below stays correct.
    return formatted.startsWith("24:") ? `00:${formatted.slice(3)}` : formatted;
  } catch {
    return null;
  }
}

/**
 * Console-tile status for one location "today," in the location's own
 * timezone. `isOpenNow` is the already-computed server value
 * (`LocationSummary.is_open_now` / `LocationDetail.is_open_now`) — when
 * it's `true` this short-circuits to `open_now` without needing hours at
 * all. `hours`/`timezone` are only consulted to tell "hasn't opened yet"
 * apart from "closed all day" when it's NOT currently open.
 *
 * A day that HAS hours but where "now" is already past `close_time`
 * resolves to `closed_now`, distinct from `closed_today` (no hours at all /
 * genuinely closed the whole day) — direct user feedback 2026-09-23: "use
 * 'closed today' label only if it's closed for the entire day, otherwise
 * say 'closed now'". Still no third label for "opens tomorrow at X" — the
 * console doesn't have tomorrow's hours in scope here.
 */
export function describeConsoleTodayStatus(
  isOpenNow: boolean | null | undefined,
  hours: readonly LocationHour[] | null | undefined,
  timezone: string | null | undefined,
  now: Date = new Date()
): ConsoleTodayStatus {
  if (isOpenNow === true) return { kind: "open_now" };

  if (!timezone) return { kind: "unknown" };
  const todayIndex = todayIndexInTimezone(timezone, now);
  if (todayIndex === null) return { kind: "unknown" };

  const today = (hours ?? []).find((h) => h.day_of_week === todayIndex) ?? null;

  // No seeded row, or "hours unknown" (is_closed: null), or genuinely
  // closed all day: all three read as "Closed today" on the console tile,
  // per this fix's brief (owner/manager needs an actionable answer, not a
  // bare "Closed" — see this file's header comment).
  if (!today || today.is_closed !== false || !today.open_time) {
    return { kind: "closed_today" };
  }

  const nowTime = currentTimeOfDay(timezone, now);
  if (nowTime !== null && nowTime < today.open_time) {
    return { kind: "opens_at", time: formatClockTime(today.open_time) };
  }
  return { kind: "closed_now" };
}
