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
 * Today's-hours label, or `null` when hours are unknown (callers render
 * nothing then — never a "Hours unknown" placeholder).
 */
export function describeTodayHours(
  isClosed: boolean | null | undefined,
  openTime: string | null | undefined,
  closeTime: string | null | undefined,
): string | null {
  if (isClosed === true) return "Closed today";
  if (isClosed === false && openTime && closeTime) {
    return `Open today ${formatShortTime(openTime)}–${formatShortTime(closeTime)}`;
  }
  return null;
}
