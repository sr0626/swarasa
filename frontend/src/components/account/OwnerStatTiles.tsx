// Stat tiles across the top of the owner's business page (/account): restaurants, locations, paid vs free locations. Counts
// are derived from data the page already loads (GET /restaurants + per-brand
// GET /restaurants/{id}/locations).
// Paid/free are only shown when every brand's locations loaded; otherwise a
// dash, never a partial (misleading) number.
//
// Pending claims are deliberately not a tile: GET /claim is admin-only, and
// there is no owner-scoped claims endpoint (flagged in the PR).

/** The minimal per-brand shape the tiles need (satisfied by any loaded brand). */
export interface OwnerStatBrand {
  locations: ReadonlyArray<{ is_paid: boolean }>;
  locationsError: string | null;
}

interface Tile {
  label: string;
  value: string;
}

export default function OwnerStatTiles({
  brands,
  loadFailed,
}: {
  brands: ReadonlyArray<OwnerStatBrand>;
  loadFailed: boolean;
}) {
  const locationsComplete = !loadFailed && brands.every((b) => b.locationsError === null);
  const paid = brands.reduce((n, b) => n + b.locations.filter((l) => l.is_paid).length, 0);
  const total = brands.reduce((n, b) => n + b.locations.length, 0);
  const dash = "—";

  const tiles: Tile[] = [
    { label: "Restaurants", value: loadFailed ? dash : String(brands.length) },
    {
      label: "Locations",
      value: locationsComplete ? String(total) : dash,
    },
    {
      label: "Paid locations",
      value: locationsComplete ? String(paid) : dash,
    },
    {
      label: "Free locations",
      value: locationsComplete ? String(total - paid) : dash,
    },
  ];

  return (
    <dl aria-label="Business overview" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5"
        >
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            {tile.label}
          </dt>
          <dd className="mt-1 font-display text-3xl font-bold text-brand-ink">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
