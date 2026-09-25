// Compact "assigned managers" summary for a location row on the owner
// dashboard, backed by the existing `GET /locations/{id}/managers`
// (docs/API_CONTRACTS.md "Location Managers") — fetched per location in
// `portal/dashboard/page.tsx`'s `loadManagersForLocation`. Read-only
// display only; assigning/removing a manager stays on the location editor
// (`LocationManagerAssignment.tsx`), not duplicated here.
import { UsersIcon } from "@/components/ui/icons";
import type { LocationManager } from "@/types/location";

export default function LocationManagersSummary({
  managers,
  error,
}: {
  managers: LocationManager[];
  error: string | null;
}) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-brand-closed">
        <UsersIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Managers unavailable
      </span>
    );
  }

  if (managers.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-brand-ink-subtle">
        <UsersIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        No managers assigned
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 max-w-full items-start gap-1.5 text-xs text-brand-ink-muted">
      <UsersIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {/* break-all: a long e-mail has no break opportunity and would push the row past the card edge on a phone. */}
      <span className="min-w-0 break-all">
        {managers.length} manager{managers.length === 1 ? "" : "s"}:{" "}
        {managers.map((m) => m.email ?? "Unknown user").join(", ")}
      </span>
    </span>
  );
}
