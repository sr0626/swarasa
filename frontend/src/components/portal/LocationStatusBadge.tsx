// Active/inactive pill for the owner dashboard, reflecting a location's
// soft-delete state (`restaurant_location.is_active` — `DELETE
// /locations/{id}` sets this `false`, never a row delete; see
// docs/API_CONTRACTS.md "DELETE /locations/{id}").
//
// `isActive` is currently always `undefined`/effectively `true` in real
// usage — see the FLAGGED CONTRACT GAP on `LocationSummary.is_active`
// (frontend/src/types/location.ts): the backend doesn't serialize it yet,
// AND the owner-scoped location list already filters to active-only
// server-side, so a deactivated location doesn't even appear in this list
// today. Rendered anyway (defaulting to "Active") so the column exists and
// starts working the moment both gaps close, with no further frontend
// change.
export default function LocationStatusBadge({ isActive = true }: { isActive?: boolean }) {
  if (!isActive) {
    return (
      <span className="inline-flex items-center rounded-brand-pill bg-brand-closed-bg px-2.5 py-1 text-xs font-semibold text-brand-closed">
        Inactive
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
      Active
    </span>
  );
}
