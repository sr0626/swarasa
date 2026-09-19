// Server-side geocoding via OpenStreetMap Nominatim.
//
// Why here and not in the backend: the API Lambda has no internet access
// (no NAT Gateway — root CLAUDE.md cost guardrail), so it cannot call a
// geocoder. The Next.js server actions run on Amplify SSR compute, which
// does have outbound internet, so the "Add restaurant" and location-editor
// actions geocode and pass `latitude`/`longitude` to POST/PATCH /locations
// (which sync the PostGIS `geom` column the search endpoint queries).
//
// Server-only: call this from server actions / server components, never
// from a client component (it would make browsers hit Nominatim directly).
//
// Usage-policy compliance (https://operations.osmfoundation.org/policies/nominatim/):
// identifying User-Agent with a contact, at most one request per second
// (fallback attempts are spaced >= 1s apart), no bulk use — one lookup per
// owner submit.
//
// Failure is never fatal: every failure mode (timeout, HTTP error, no
// match, implausible result) returns null, and callers create/update the
// listing anyway with no coordinates rather than fabricating any.
import { CONTACT_EMAIL } from "@/lib/contact";
import {
  buildGeocodeQueries,
  parseNominatimResponse,
  type GeocodeAddress,
  type GeocodeResult,
} from "./pure";

export type { GeocodeAddress, GeocodePrecision, GeocodeResult } from "./pure";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const REQUEST_TIMEOUT_MS = 4_000;
/** Whole-lookup budget across every fallback attempt. */
const TOTAL_BUDGET_MS = 10_000;
/** Nominatim policy: max 1 request/second. */
const MIN_REQUEST_SPACING_MS = 1_100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookup(q: string): Promise<{ latitude: number; longitude: number } | null> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", q);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": `Swarasa/1.0 (Indian restaurant directory; contact: ${CONTACT_EMAIL})`,
        Accept: "application/json",
      },
      signal: controller.signal,
      // Owner-entered addresses; never serve from / write to Next's data cache.
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseNominatimResponse(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort geocode. Resolves to null (never throws) when no query in
 * the fallback chain yields a plausible US position within the time budget.
 */
export async function geocodeAddress(address: GeocodeAddress): Promise<GeocodeResult | null> {
  const started = Date.now();
  const queries = buildGeocodeQueries(address);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    if (i > 0) {
      if (Date.now() - started + MIN_REQUEST_SPACING_MS + REQUEST_TIMEOUT_MS > TOTAL_BUDGET_MS) {
        return null;
      }
      await sleep(MIN_REQUEST_SPACING_MS);
    }
    const hit = await lookup(query.q);
    if (hit) return { ...hit, precision: query.precision };
  }
  return null;
}
