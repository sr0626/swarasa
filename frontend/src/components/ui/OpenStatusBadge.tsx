// Shared open/closed status pill for every PUBLIC surface (search/home/
// favourites tiles via RestaurantCard, the brand-landing cards, the location
// page's Details card, the admin listing rows). All copy comes from
// `describeOpenStatus` (lib/formatHours.ts) — one rule, no per-surface fork:
// "Open now · until 10pm", "Closed now · opens 10am", "Closed now",
// "Closed today" (closed the ENTIRE day only). Renders nothing when hours are
// unknown (no "Hours unknown" label).
//
// Every input is a server-computed value from the API payload in the
// location's own timezone — the browser clock is never consulted.
import { describeOpenStatus, type OpenStatusTone } from "@/lib/formatHours";

const TONE_CLASS: Record<OpenStatusTone, string> = {
  open: "bg-brand-success-bg text-brand-success",
  opens_later: "bg-brand-chip text-brand-ink-muted",
  closed: "bg-brand-closed-bg text-brand-closed",
};

export default function OpenStatusBadge({
  isOpenNow,
  isClosedToday,
  openTime,
  closeTime,
  opensLaterToday,
}: {
  isOpenNow: boolean | null | undefined;
  isClosedToday?: boolean | null;
  openTime?: string | null;
  closeTime?: string | null;
  opensLaterToday?: boolean | null;
}) {
  const label = describeOpenStatus({
    isOpenNow,
    isClosedToday,
    openTime,
    closeTime,
    opensLaterToday,
  });
  if (label === null) return null;
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-brand-pill px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[label.tone]}`}
    >
      {label.text}
    </span>
  );
}
