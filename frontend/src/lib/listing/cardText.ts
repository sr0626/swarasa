// Pure text/URL helpers for the shared restaurant tile
// (components/listing/RestaurantCard.tsx, used by home, search and the
// favourites grid). Extracted so they are unit-tested (`node --test`) rather
// than living inline in JSX.

/** The address fields a tile needs (a subset of `SearchNearestLocation`). */
export interface CardAddress {
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
}

/** "123 Main St, Irving, TX 75038" — the tile's address line and map query. */
export function formatFullAddress(a: CardAddress): string {
  return `${a.address_line1}, ${a.city}, ${a.state} ${a.postal_code}`;
}

/**
 * Google Maps search link for an address (opens the Maps app on phones).
 * Only the address text is sent, never anything about the viewer.
 */
export function googleMapsSearchUrl(fullAddress: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
}

/**
 * The tile's single bottom-right cover chip: "Unclaimed" takes precedence
 * over an "N locations" count; null when neither applies.
 */
export function cardSideNote(isClaimed: boolean, locationCount: number): string | null {
  if (!isClaimed) return "Unclaimed";
  if (locationCount > 1) return `${locationCount} locations`;
  return null;
}
