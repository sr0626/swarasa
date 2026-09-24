// The ONE place that builds public restaurant URLs. Every link to a
// restaurant page (tiles, admin queues, console "View public page", sitemap,
// canonical tags) goes through these helpers so the routing rules live here:
//
//   /restaurant/{brandSlug}                 brand URL — the LANDING page for a brand
//                                           with several active locations, or that one
//                                           location's profile for a single-location brand
//   /restaurant/{brandSlug}/{locationSlug}  a location's own profile page
//   /restaurant/{brandSlug}/report          "report a problem" (brand-level form) — which is
//                                           why "report" is a reserved location slug
//
// LINK-TARGET RULE (consistent everywhere): anything that represents a
// specific LOCATION (search/home/favourites tiles, a manager's location, a
// reopen request) links to `locationHref`; anything that represents the
// BRAND (owner dashboard brand card, admin listings, claims) links to
// `brandHref`, which is right in both cases. The CANONICAL URL of a
// single-location brand's page is the short brand URL (`canonicalPath`).
//
// Pure functions, no alias imports: unit-tested with `node --test`.

/** `/restaurant/{brandSlug}` */
export function brandHref(brandSlug: string): string {
  return `/restaurant/${brandSlug}`;
}

/** `/restaurant/{brandSlug}/{locationSlug}` */
export function locationHref(brandSlug: string, locationSlug: string): string {
  return `/restaurant/${brandSlug}/${locationSlug}`;
}

/** Anchor id of the deals section on a location page. */
export const DEALS_ANCHOR = "deals";

/** `/restaurant/{brandSlug}/{locationSlug}#deals` */
export function locationDealsHref(brandSlug: string, locationSlug: string): string {
  return `${locationHref(brandSlug, locationSlug)}#${DEALS_ANCHOR}`;
}

/** `/restaurant/{brandSlug}/report[?location={id}]` — the brand-level report form, optionally
 * with the location pre-selected. */
export function reportHref(brandSlug: string, locationId?: number | null): string {
  const base = `/restaurant/${brandSlug}/report`;
  return locationId ? `${base}?location=${locationId}` : base;
}

/**
 * The owner/admin console's "view the page" link for ONE location: always the
 * location's own URL (never the brand URL, which for a single-location brand
 * 404s while that location is hidden). Only an `active` location is public;
 * any other status is a preview only its owner/admin/manager can open, so it
 * reads "Preview page".
 */
export function ownerLocationPageLink(
  brandSlug: string,
  location: { slug: string; status: string }
): { href: string; label: "View public page" | "Preview page" } {
  return {
    href: locationHref(brandSlug, location.slug),
    label: location.status === "active" ? "View public page" : "Preview page",
  };
}

/**
 * The console's brand-level page link. It only adds value when the brand has
 * two or more ACTIVE locations (the brand URL is then its landing page listing
 * them); for a single location the per-location link replaces it, so `null`.
 */
export function ownerBrandPageLink(
  brandSlug: string,
  activeLocationCount: number
): { href: string; label: "View all locations" } | null {
  if (activeLocationCount < 2) return null;
  return { href: brandHref(brandSlug), label: "View all locations" };
}

/**
 * Canonical path of a LOCATION page. A brand with exactly ONE active location
 * has its profile at the short brand URL, so the long location URL (which
 * must keep working) canonicalises to it — no duplicate content, no broken
 * links. Anything else (several active locations, or a hidden location being
 * previewed by its owner) canonicalises to its own long URL.
 */
export function canonicalPath(input: {
  brandSlug: string;
  locationSlug: string;
  /** The brand's ACTIVE location count (`RestaurantBrand.location_count`). */
  activeLocationCount: number;
  /** Whether this location is itself `active` (a hidden preview never is the sole public page). */
  isActive: boolean;
}): string {
  return input.activeLocationCount === 1 && input.isActive
    ? brandHref(input.brandSlug)
    : locationHref(input.brandSlug, input.locationSlug);
}
