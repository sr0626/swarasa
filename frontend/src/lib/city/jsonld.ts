// schema.org JSON-LD for the city landing pages. Pure: unit-tested with
// `node --test`. Embed with `jsonLdString` (lib/menu/jsonld.ts).
//
// City page: an `ItemList` of `Restaurant` entries mirroring the multi-location
// landing page's list (lib/restaurant/jsonld.ts `buildLandingSchema`) — each
// entry carries the location's CANONICAL absolute URL (a brand with exactly one
// active location canonicalises to the short brand URL, `canonicalPath`),
// address, phone, cuisines and cover image. `position` continues across pages.
import type { SearchResultItem } from "../../types/search.ts";

// The two path shapes are written out here (not imported) because `node
// --test` can't resolve extensionless alias imports and `tsc` rejects `.ts`
// runtime import specifiers; city.test.ts asserts they stay identical to
// `canonicalPath` (lib/restaurant/urls.ts) and `cityPath` (./paths.ts).
const cityPath = (citySlug: string): string => `/indian-restaurants/${citySlug}`;
/** `canonicalPath` for an ACTIVE location: a brand with exactly one active
 * location canonicalises to the short brand URL. */
const canonicalLocationPath = (
  brandSlug: string,
  locationSlug: string,
  activeLocationCount: number
): string =>
  activeLocationCount === 1
    ? `/restaurant/${brandSlug}`
    : `/restaurant/${brandSlug}/${locationSlug}`;

export function buildCityItemListSchema(input: {
  heading: string;
  /** Absolute site origin, no trailing slash. */
  siteUrl: string;
  results: readonly SearchResultItem[];
  /** 1-based page and page size, so `position` is global across pages. */
  page: number;
  pageSize: number;
  /** Total publicly visible locations in the city (all pages). */
  total: number;
}) {
  const { heading, siteUrl, results, page, pageSize, total } = input;
  const offset = (page - 1) * pageSize;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: heading,
    numberOfItems: total,
    itemListElement: results.map((item, index) => {
      const location = item.nearest_location;
      const cover = item.cover_photo_url;
      return {
        "@type": "ListItem",
        position: offset + index + 1,
        item: {
          "@type": "Restaurant",
          name: item.name,
          url: `${siteUrl}${canonicalLocationPath(item.slug, location.slug, item.location_count_nearby)}`,
          servesCuisine: item.cuisine_tags.map((tag) => tag.display_name),
          address: {
            "@type": "PostalAddress",
            streetAddress: location.address_line1,
            addressLocality: location.city,
            addressRegion: location.state,
            postalCode: location.postal_code,
          },
          ...(location.phone ? { telephone: location.phone } : {}),
          ...(cover ? { image: cover } : {}),
        },
      };
    }),
  };
}

/** City index: an `ItemList` of the city landing pages. */
export function buildCityIndexSchema(input: {
  siteUrl: string;
  cities: readonly { slug: string; city: string; state: string; location_count: number }[];
}) {
  const { siteUrl, cities } = input;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Indian restaurants by city",
    numberOfItems: cities.length,
    itemListElement: cities.map((city, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${siteUrl}${cityPath(city.slug)}`,
      name: `Indian Restaurants in ${city.state ? `${city.city}, ${city.state}` : city.city}`,
    })),
  };
}
