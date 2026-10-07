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

// ---------------------------------------------------------------------------
// Location-level display helpers for the admin Listings page (GET
// /admin/listings). Structural argument types (not the `@/types` interfaces)
// so this file stays importable by `node --test` without the `@/` alias.
// ---------------------------------------------------------------------------

/** "Active", "Coming soon", ... -- the per-location status tag text. */
export const LOCATION_STATUS_LABELS: Record<ListingLocationStatus, string> = {
  active: "Active",
  owner_deactivated: "Hidden (owner)",
  coming_soon: "Coming soon",
  closed_pending_reopen: "Closed (reopen pending)",
};

/** `Owner: <email>` / `Unclaimed` / `Owner: deleted account`. */
export function ownerLine(brand: {
  owner_id: number | null;
  owner_email: string | null;
  owner_deleted: boolean;
}): string {
  if (brand.owner_deleted) return "Owner: deleted account";
  if (brand.owner_email) return `Owner: ${brand.owner_email}`;
  if (brand.owner_id === null) return "Unclaimed";
  // Claimed but no email resolvable -- never happens for a live owner row;
  // show the id rather than hiding the ownership.
  return `Owner: #${brand.owner_id}`;
}

/**
 * Who-created text for the "Created <date> by <who> (<role>)" line, or `null`
 * when the creator is unknown (the line then shows the date alone). System
 * actors read e.g. "import (system)"; people read "root@example.com (admin)".
 */
export function creatorText(creator: {
  created_by_role: string | null;
  created_by_label: string | null;
}): string | null {
  if (!creator.created_by_role || !creator.created_by_label) return null;
  return `${creator.created_by_label} (${creator.created_by_role})`;
}

/** True when any location-level filter (status other than `deleted`, tier, city) is set. */
export function hasLocationFilter(filters: {
  status?: ListingStatusFilter;
  isPaid?: boolean;
  city?: string;
}): boolean {
  return (
    (filters.status !== undefined && filters.status !== "deleted") ||
    filters.isPaid !== undefined ||
    Boolean(filters.city)
  );
}

/** "2 of 3 locations match" (only meaningful while a location filter is set). */
export function matchSummary(locations: ReadonlyArray<{ matches_filter: boolean }>): string {
  const matching = locations.filter((location) => location.matches_filter).length;
  const noun = locations.length === 1 ? "location" : "locations";
  return `${matching} of ${locations.length} ${noun} match`;
}

/**
 * Address line for a location row: "123 Main St, Suite 4, Plano, TX 75024".
 * Skips empty parts so a missing line 2 / postal code leaves no stray commas.
 */
export function addressLine(location: {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
}): string {
  const region = [location.state, location.postal_code].filter(Boolean).join(" ");
  return [location.address_line1, location.address_line2, location.city, region]
    .filter((part) => Boolean(part && part.trim()))
    .join(", ");
}
