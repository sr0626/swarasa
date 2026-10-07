// Compact 12-hour formatting for the tile's "Open today 11am–9pm" label.

/** "11:00:00" -> "11am", "21:30:00" -> "9:30pm", "00:00:00" -> "12am". */
export function formatShortTime(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const hour = parseInt(hourStr ?? "", 10);
  const minute = parseInt(minuteStr ?? "0", 10);
  if (Number.isNaN(hour)) return time;
  const period = hour >= 12 && hour < 24 ? "pm" : "am";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return minute > 0
    ? `${displayHour}:${String(minute).padStart(2, "0")}${period}`
    : `${displayHour}${period}`;
}

/**
 * Today's day-of-week as the API indexes it (0=Monday..6=Sunday) in the
 * LOCATION's timezone -- not the server's or the visitor's, since "today"
 * on a restaurant's hours list means the restaurant's today. `null` when
 * the timezone string is unusable (callers then just skip the highlight).
 */
export function todayIndexInTimezone(timeZone: string, now: Date = new Date()): number | null {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(now);
    const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
    return index === -1 ? null : index;
  } catch {
    return null;
  }
}

export type OpenStatusTone = "open" | "opens_later" | "closed";

export interface OpenStatusLabel {
  text: string;
  tone: OpenStatusTone;
}

export interface OpenStatusInput {
  /** Server-computed "open right now" in the location's timezone. */
  isOpenNow: boolean | null | undefined;
  /** Today's `is_closed` (closed the ENTIRE day). */
  isClosedToday?: boolean | null;
  openTime?: string | null;
  closeTime?: string | null;
  /** Server-computed: "now" is before today's opening time. Only meaningful
   * when `isOpenNow` is false; absent on an older API. */
  opensLaterToday?: boolean | null;
}

/**
 * THE public open/closed pill copy, shared by every surface (search / home /
 * favourites tiles, the brand-landing cards, the location page's Details
 * card, the admin listing rows). Pure: every input is a server-computed
 * value from the API payload (`is_open_now`, today's open/close,
 * `opens_later_today`, all evaluated in the LOCATION's timezone) — never the
 * viewer's clock, so SSR + the data cache can't make it wrong beyond the
 * cache window itself.
 *
 *   closed all day                 -> "Closed today"
 *   open right now                 -> "Open now · until 10pm"
 *   closed now, opens later today  -> "Closed now · opens 10am"
 *   closed now, already past close -> "Closed now"
 *   closed now, phase unknown      -> "Closed now · today 10am–10pm"
 *   hours unknown                  -> null (callers render nothing)
 *
 * "Closed today" is reserved for a location that is closed for the entire
 * day (direct user feedback 2026-09-24).
 */
export function describeOpenStatus(input: OpenStatusInput): OpenStatusLabel | null {
  const { isOpenNow, isClosedToday, openTime, closeTime, opensLaterToday } = input;
  if (isClosedToday === true) return { text: "Closed today", tone: "closed" };

  if (isOpenNow === true) {
    return {
      text: closeTime ? `Open now · until ${formatShortTime(closeTime)}` : "Open now",
      tone: "open",
    };
  }

  if (isOpenNow === false) {
    if (opensLaterToday === true && openTime) {
      return { text: `Closed now · opens ${formatShortTime(openTime)}`, tone: "opens_later" };
    }
    if (opensLaterToday !== false && openTime && closeTime) {
      return {
        text: `Closed now · today ${formatShortTime(openTime)}–${formatShortTime(closeTime)}`,
        tone: "closed",
      };
    }
    return { text: "Closed now", tone: "closed" };
  }

  return null;
}
