// Owner/manager console-only open/closed status pill for restaurant/location
// tiles (components/portal/BrandCard.tsx, components/account/
// ManagedLocationsPanel.tsx). NOT used on the public search/listing pages —
// those keep components/ui/OpenStatusBadge.tsx's deliberate behavior
// ("no Open today Xam-Ypm label" history noted in that file). The
// owner/manager console wants actionable wording instead of a bare
// "Closed": "Opens at 11:00 AM" when the location just hasn't opened yet
// today, "Closed today" when it's closed all day (or hours aren't set),
// otherwise the existing "Open Now" indicator.
//
// Status is computed by lib/consoleLocationStatus.ts's
// `describeConsoleTodayStatus` — kept as a pure function so this component
// stays a dumb renderer and any future non-tile surface can reuse the same
// rule without re-deriving it.
import type { ConsoleTodayStatus } from "@/lib/consoleLocationStatus";

export default function LocationStatusChip({ status }: { status: ConsoleTodayStatus }) {
  const base = "inline-flex items-center rounded-brand-pill px-2.5 py-1 text-xs font-semibold";

  switch (status.kind) {
    case "open_now":
      return <span className={`${base} bg-brand-success-bg text-brand-success`}>Open Now</span>;
    case "opens_at":
      return (
        <span className={`${base} bg-brand-chip text-brand-ink-subtle`}>
          Opens at {status.time}
        </span>
      );
    case "closed_today":
      return <span className={`${base} bg-brand-closed-bg text-brand-closed`}>Closed today</span>;
    case "unknown":
    default:
      return null;
  }
}
