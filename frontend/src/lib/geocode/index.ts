// Server-side geocoding entry point — wires the injectable core
// (./geocoder.ts: US Census Geocoder first, Nominatim fallback) to the real
// `fetch`, User-Agent and clock. Call from server actions / server
// components only, never from a client component (it would make browsers
// call the providers directly and leak the User-Agent contact).
//
// Nominatim's usage policy
// (https://operations.osmfoundation.org/policies/nominatim/) requires an
// identifying User-Agent with a contact; it is only used as a fallback, at
// most a few requests per owner submit, spaced >= 1s apart.
import { CONTACT_EMAIL } from "@/lib/contact";
import {
  geocodeFreeformQuery,
  geocodeWithProviders,
  type GeocodeAddress,
  type GeocodeDeps,
  type GeocodeResult,
} from "./geocoder";

export type { GeocodeAddress, GeocodePrecision, GeocodeResult } from "./geocoder";

const REAL_DEPS: GeocodeDeps = {
  fetchFn: (url, init) => fetch(url, init),
  userAgent: `Swarasa/1.0 (Indian restaurant directory; contact: ${CONTACT_EMAIL})`,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Resolves to null (never throws) when the address can't be placed on the map. */
export function geocodeAddress(address: GeocodeAddress): Promise<GeocodeResult | null> {
  return geocodeWithProviders(address, REAL_DEPS);
}

/**
 * Resolves the search page's freeform "City, ZIP, or neighborhood" text box
 * to coordinates (Census first, Nominatim fallback — see geocoder.ts).
 * Server-side only, same as `geocodeAddress`. Resolves to null (never
 * throws) when the query can't be placed — callers should treat that as
 * "no such place," not "fall back to the default area."
 */
export function geocodeSearchLocation(query: string): Promise<GeocodeResult | null> {
  return geocodeFreeformQuery(query, REAL_DEPS);
}
