// Pure helpers for the admin listings page (`/admin/listings`) — kept free of
// React/Next imports so they're unit-testable with `node --test`
// (see adminListings.test.ts).

/** Every `restaurant_location.status` value, mirrored from `LocationStatus`
 * in `@/types/location` (redeclared, not imported, so this file stays
 * importable by `node --test` without the `@/` path alias). */
const LOCATION_STATUS_VALUES = [
  "active",
  "owner_deactivated",
  "coming_soon",
  "closed_pending_reopen",
] as const;

export type ListingLocationStatus = (typeof LOCATION_STATUS_VALUES)[number];

/** `GET /restaurants?status=` accepts every location status PLUS the
 * pseudo-status `deleted` = "only soft-deleted listings"
 * (docs/API_CONTRACTS.md "GET /restaurants"). */
export type ListingStatusFilter = ListingLocationStatus | "deleted";

/** Parses the `status` query-string value; anything unknown is "no filter". */
export function parseListingStatusFilter(value: string | undefined): ListingStatusFilter | undefined {
  if (value === "deleted") return "deleted";
  return LOCATION_STATUS_VALUES.find((s) => s === value);
}

/**
 * Warning shown before an admin confirms "Delete listing". `activeLocationCount`
 * is the brand's `location_count` from `GET /restaurants` — which counts
 * ACTIVE locations only, i.e. exactly the ones the delete will deactivate
 * (locations that are already hidden are left as they are).
 */
export function deleteListingWarning(activeLocationCount: number): string {
  const locations =
    activeLocationCount === 0
      ? "This restaurant has no active locations to deactivate."
      : activeLocationCount === 1
        ? "This will deactivate its 1 active location."
        : `This will deactivate all ${activeLocationCount} of its active locations.`;
  return (
    `${locations} The listing will be hidden from the public (search, its page, ` +
    `favourites) and from the owner's console. Nothing is permanently erased — ` +
    `you can restore the listing later, but its locations stay deactivated until re-enabled.`
  );
}
