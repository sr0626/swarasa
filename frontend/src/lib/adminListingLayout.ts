// Pure layout decisions + label builders for the admin Listings brand card
// (`AdminListingsPanel.tsx`), kept free of React/Next imports so they are
// unit-testable with `node --test` (see adminListingLayout.test.ts).
//
// One restaurant with exactly one location is ONE merged card; a child
// "location" card only appears when the restaurant has 2 or more. The count is
// the brand's TOTAL locations (`AdminListing.locations`, which
// `GET /admin/listings` returns in every status and regardless of the active
// location filter) -- NOT `location_count` (active only) and NOT the
// filter-matching subset. A 3-location brand where only 1 matches the filter is
// therefore still "multi" and shows that match under the parent.

export type BrandLayout = "empty" | "single" | "multi";

export const DELETE_RESTAURANT_LABEL = "Delete restaurant";
export const EDIT_LOCATION_LABEL = "Edit location";
export const NO_LOCATIONS_LABEL = "No locations yet";

/** Which card layout a brand gets, from its TOTAL location count. */
export function brandLayout(totalLocations: number): BrandLayout {
  if (totalLocations <= 0) return "empty";
  return totalLocations === 1 ? "single" : "multi";
}

/** "Locations (3)" sub-heading above the child rows. */
export function locationsHeading(totalLocations: number): string {
  return `Locations (${totalLocations})`;
}

/** Toggle text for the multi-location brand's child rows. */
export function locationsToggleLabel(expanded: boolean, totalLocations: number): string {
  return expanded ? "Hide locations" : `Show locations (${totalLocations})`;
}

/** The brand's meta line: slug, location counts (multi only) and followers. */
export function brandMetaLine(brand: {
  slug: string;
  follower_count: number;
  location_count: number;
  totalLocations: number;
}): string {
  const parts = [`/${brand.slug}`];
  if (brandLayout(brand.totalLocations) === "multi") {
    parts.push(`${brand.location_count} active of ${brand.totalLocations} locations`);
  }
  parts.push(`${brand.follower_count} follower${brand.follower_count === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

interface AddressParts {
  location_name: string | null;
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
}

/** Same shape as `addressLine` in adminListings.ts (not imported: sibling
 * imports need a `.ts` extension under `node --test`, which `tsc` rejects). */
function addressLine(location: AddressParts): string {
  const region = [location.state, location.postal_code].filter(Boolean).join(" ");
  return [location.address_line1, location.address_line2, location.city, region]
    .filter((part) => Boolean(part && part.trim()))
    .join(", ");
}

/**
 * Child-row heading + the rest of the address, so the street is shown ONCE:
 *  - unnamed location: title "Location · 123 Main St", detail "Suite 4, Plano, TX 75024"
 *  - named location:   title "Location · <name>",     detail the FULL address
 */
export function childLocationText(location: AddressParts): { title: string; detail: string } {
  const name = location.location_name?.trim();
  if (name && name !== location.address_line1.trim()) {
    return { title: `Location · ${name}`, detail: addressLine(location) };
  }
  const region = [location.state, location.postal_code].filter(Boolean).join(" ");
  const detail = [location.address_line2, location.city, region]
    .filter((part) => Boolean(part && part.trim()))
    .join(", ");
  return { title: `Location · ${location.address_line1}`, detail };
}

/** The single (merged) card shows the full address once; the optional location
 * name is returned separately so it can be shown only when it adds something. */
export function mergedLocationText(location: AddressParts): { name: string | null; address: string } {
  const name = location.location_name?.trim();
  return {
    name: name && name !== location.address_line1.trim() ? name : null,
    address: addressLine(location),
  };
}

interface CreatorLike {
  created_at: string | null;
  created_by_role: string | null;
  created_by_label: string | null;
}

/** True when a location's "Created ... by ..." line says the same as the
 * brand's, so the merged single card can show it once. Compares the calendar
 * day (UTC date part) and the actor. */
export function sameProvenance(a: CreatorLike, b: CreatorLike): boolean {
  const day = (v: string | null): string => (v ? v.slice(0, 10) : "");
  return (
    day(a.created_at) === day(b.created_at) &&
    a.created_by_role === b.created_by_role &&
    a.created_by_label === b.created_by_label
  );
}
