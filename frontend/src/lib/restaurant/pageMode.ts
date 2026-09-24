// What `/restaurant/{brandSlug}` renders, decided from the brand's ACTIVE
// locations (`RestaurantPublic.locations`):
//
//   0 locations -> "none":    brand-only page (name, description, claim CTA) — as before
//   1 location  -> "single":  that location's full profile AT the brand URL (canonical =
//                             the brand URL; the long location URL also works and
//                             canonicalises here)
//   2+          -> "landing": brand header + one card per location, each linking to the
//                             location's own page
//
// Old shared links to /restaurant/{brandSlug} therefore keep working in every
// case — including when a second location is added later (the URL simply
// becomes the landing page). Pure: unit-tested with `node --test`.

interface HasCityAndId {
  location_id: number;
  city: string;
}

export type BrandPageMode<T> =
  | { kind: "none" }
  | { kind: "single"; location: T }
  | { kind: "landing"; locations: T[] };

/** Stable landing order: city (case-insensitive, locale-aware), then id. */
export function sortLocationsForLanding<T extends HasCityAndId>(locations: readonly T[]): T[] {
  return [...locations].sort((a, b) => {
    const byCity = a.city.localeCompare(b.city, "en", { sensitivity: "base" });
    return byCity !== 0 ? byCity : a.location_id - b.location_id;
  });
}

export function decideBrandPage<T extends HasCityAndId>(
  locations: readonly T[]
): BrandPageMode<T> {
  const [only, ...rest] = locations;
  if (only === undefined) return { kind: "none" };
  if (rest.length === 0) return { kind: "single", location: only };
  return { kind: "landing", locations: sortLocationsForLanding(locations) };
}
