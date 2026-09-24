// Status pill for a location's product-state lifecycle (backend/app/models/
// restaurant_location.py "Location status lifecycle") — shown on the owner
// dashboard tiles (BrandCard.tsx) and the location editor
// (LocationStatusMenu.tsx). Four states now (was a plain active/inactive
// boolean before docs/PROJECT_PLAN.csv "Location status lifecycle" — see
// that migration's note on `restaurant_location.status` replacing
// `is_active`); `LocationSummary.status`/`LocationDetail.status` are now
// always serialized by the backend, so this never falls back to a guess.
import type { LocationStatus } from "@/types/location";

const LABELS: Record<LocationStatus, string> = {
  active: "Active",
  owner_deactivated: "Hidden",
  coming_soon: "Coming soon",
  closed_pending_reopen: "Closed — pending reopen",
};

export default function LocationStatusBadge({ status }: { status: LocationStatus }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
        {LABELS.active}
      </span>
    );
  }
  if (status === "coming_soon") {
    // Deliberately louder than "Active": a listing in setup is not public yet
    // and needs the owner to finish it, so it gets a gold fill + ring and a dot.
    return (
      <span className="inline-flex items-center gap-1.5 rounded-brand-pill bg-brand-accent-gold/40 px-2.5 py-1 text-xs font-bold text-brand-ink ring-1 ring-inset ring-brand-accent-gold">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-accent-warm" />
        {LABELS.coming_soon}
      </span>
    );
  }
  // owner_deactivated and closed_pending_reopen both read as "hidden from
  // the public" — same visual treatment, different label.
  return (
    <span className="inline-flex items-center rounded-brand-pill bg-brand-closed-bg px-2.5 py-1 text-xs font-semibold text-brand-closed">
      {LABELS[status]}
    </span>
  );
}
