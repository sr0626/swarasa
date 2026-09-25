// schema.org JSON-LD builders for the public restaurant pages.
//
// JSON-LD CHOICE (per page kind):
//   - LOCATION page (and a single-location brand's page at the brand URL): one
//     `Restaurant` with THAT location's address, phone, hours and geo, the
//     brand's name + cuisines, and `hasMenu` — exactly what search engines want
//     for a local business, one entity per physical place. `url` is the page's
//     canonical URL.
//   - LANDING page (brand with several locations): an `ItemList` of
//     `Restaurant` entries, one per location, each with its own `url` (the
//     location page), address and phone. The landing page describes a
//     collection of places, not a single place, so it deliberately does NOT
//     claim one address.
//
// Pure, no alias imports (type imports are erased): unit-tested with
// `node --test`. Pass the result through `jsonLdString` (lib/menu/jsonld.ts)
// when embedding it in a <script> tag.
import type { LocationDetail, LocationHour } from "@/types/location";
import type { BrandLocationCard, RestaurantBrand } from "@/types/restaurant";

/** schema.org day abbreviations, indexed 0=Monday..6=Sunday like `restaurant_hours.day_of_week`. */
const SCHEMA_DAY_ABBREVIATIONS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** `openingHours` strings (e.g. "Mo 11:00-22:00") from the real hours rows —
 * closed/unknown days are omitted rather than guessed. */
export function buildOpeningHoursSchema(hours: readonly LocationHour[]): string[] {
  return hours
    .filter((hour) => hour.is_closed === false && hour.open_time && hour.close_time)
    .map(
      (hour) =>
        `${SCHEMA_DAY_ABBREVIATIONS[hour.day_of_week]} ${hour.open_time!.slice(0, 5)}-${hour.close_time!.slice(0, 5)}`
    );
}

/** `Restaurant` for ONE location. `hasMenu` is the ready-made `Menu` node (or null). */
export function buildLocationRestaurantSchema(input: {
  restaurant: Pick<RestaurantBrand, "name" | "cuisine_tags">;
  location: LocationDetail | null;
  hasMenu: object | null;
  /** Absolute canonical URL of the page. */
  url?: string;
}) {
  const { restaurant, location, hasMenu, url } = input;
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurant.name,
    ...(url ? { url } : {}),
    // Per-location tags: THIS location's cuisines (brand union only when there is no location).
    servesCuisine: ((location ? location.cuisine_tags : restaurant.cuisine_tags) ?? []).map(
      (tag) => tag.display_name
    ),
    ...(hasMenu ? { hasMenu } : {}),
    ...(location
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: location.address_line1,
            addressLocality: location.city,
            addressRegion: location.state,
            postalCode: location.postal_code,
          },
          telephone: location.phone,
          openingHours: buildOpeningHoursSchema(location.hours),
          ...(location.cover_photo_url ? { image: location.cover_photo_url } : {}),
          ...(location.latitude !== null && location.longitude !== null
            ? {
                geo: {
                  "@type": "GeoCoordinates",
                  latitude: location.latitude,
                  longitude: location.longitude,
                },
              }
            : {}),
        }
      : {}),
  };
}

/** `ItemList` of `Restaurant` for the multi-location landing page. `locationUrl` builds each
 * entry's absolute page URL. */
export function buildLandingSchema(input: {
  restaurant: Pick<RestaurantBrand, "name" | "cuisine_tags">;
  locations: readonly BrandLocationCard[];
  locationUrl: (locationSlug: string) => string;
}) {
  const { restaurant, locations, locationUrl } = input;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${restaurant.name} locations`,
    numberOfItems: locations.length,
    itemListElement: locations.map((location, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Restaurant",
        name: location.location_name
          ? `${restaurant.name} — ${location.location_name}`
          : `${restaurant.name} — ${location.city}`,
        url: locationUrl(location.slug),
        servesCuisine: (location.cuisine_tags ?? []).map((tag) => tag.display_name),
        address: {
          "@type": "PostalAddress",
          streetAddress: location.address_line1,
          addressLocality: location.city,
          addressRegion: location.state,
          postalCode: location.postal_code,
        },
        telephone: location.phone,
      },
    })),
  };
}
