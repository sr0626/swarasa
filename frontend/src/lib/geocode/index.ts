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
import { geocodeWithProviders, type GeocodeAddress, type GeocodeResult } from "./geocoder";

export type { GeocodeAddress, GeocodePrecision, GeocodeResult } from "./geocoder";

/** Resolves to null (never throws) when the address can't be placed on the map. */
export function geocodeAddress(address: GeocodeAddress): Promise<GeocodeResult | null> {
  return geocodeWithProviders(address, {
    fetchFn: (url, init) => fetch(url, init),
    userAgent: `Swarasa/1.0 (Indian restaurant directory; contact: ${CONTACT_EMAIL})`,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  });
}
