// Shared open/closed status pill — extracted from `RestaurantCard` so the
// public restaurant detail page's hero can reuse the exact same styling
// (task brief: "is_open_now status badge (reuse the open/closed badge
// styling from RestaurantCard)") instead of forking a second copy.
//
// Renders nothing when hours are unknown (no "Hours unknown" label).
// With only `isOpenNow`, shows the plain "Open Now" / "Closed" pill. When
// today's hours are also passed (search tile), shows "Open today 11am–9pm"
// or "Closed today"; the pill colour is the open-now cue (green = open
// right now, neutral = not open right now).
import { describeTodayHours } from "@/lib/formatHours";

export default function OpenStatusBadge({
  isOpenNow,
  isClosedToday,
  openTime,
  closeTime,
}: {
  isOpenNow: boolean | null | undefined;
  isClosedToday?: boolean | null;
  openTime?: string | null;
  closeTime?: string | null;
}) {
  const todayLabel = describeTodayHours(isClosedToday, openTime, closeTime);
  const base =
    "inline-flex items-center rounded-brand-pill px-2.5 py-1 text-xs font-semibold";

  if (todayLabel !== null) {
    const tone =
      isClosedToday === true
        ? "bg-brand-closed-bg text-brand-closed"
        : isOpenNow === true
          ? "bg-brand-success-bg text-brand-success"
          : "bg-brand-chip text-brand-ink-subtle";
    const nowCue =
      isOpenNow === true ? " (open now)" : isOpenNow === false ? " (closed now)" : "";
    return (
      <span className={`${base} ${tone}`} title={`${todayLabel}${nowCue}`}>
        {todayLabel}
        <span className="sr-only">{nowCue}</span>
      </span>
    );
  }

  if (isOpenNow === null || isOpenNow === undefined) return null;
  if (isOpenNow) {
    return (
      <span className={`${base} bg-brand-success-bg text-brand-success`}>
        Open Now
      </span>
    );
  }
  return (
    <span className={`${base} bg-brand-closed-bg text-brand-closed`}>Closed</span>
  );
}
