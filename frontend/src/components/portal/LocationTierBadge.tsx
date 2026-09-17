// Read-only tier/billing status pill for the owner dashboard — derived
// from `is_paid`/`paid_until`, both already stored on `restaurant_location`
// (root CLAUDE.md "Tier model (is_paid)"). Deliberately NO upgrade/
// downgrade UI here: Stripe billing management is Phase 2 scope
// (docs/PROJECT_PLAN.csv "Owner dashboard: richer restaurant table" row —
// "only billing MANAGEMENT actions ... depend on Stripe"). This component
// only ever reads and displays tier state.
//
// `paidUntil` is currently always `undefined` in real usage — see the
// FLAGGED CONTRACT GAP on `LocationSummary.paid_until`
// (frontend/src/types/location.ts): the backend doesn't serialize it yet.
// The date renders automatically the moment it starts arriving.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function LocationTierBadge({
  isPaid,
  paidUntil,
}: {
  isPaid: boolean;
  paidUntil?: string | null;
}) {
  if (!isPaid) {
    return (
      <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
        Free tier
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-brand-pill bg-brand-success-bg px-2.5 py-1 text-xs font-semibold text-brand-success">
      Paid{paidUntil ? ` until ${formatDate(paidUntil)}` : ""}
    </span>
  );
}
