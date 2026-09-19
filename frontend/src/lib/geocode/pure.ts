// Pure, dependency-free parts of the geocoder (query building, unit
// stripping, response parsing, US plausibility check) — split from
// nominatim.ts so they can be unit-tested with `node --test` without
// resolving the "@/..." path alias (see pure.test.ts).

export interface GeocodeAddress {
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
}

export type GeocodePrecision = "address" | "street" | "postal_code";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Which query in the fallback chain matched; "postal_code" is only an approximate (ZIP-area) position. */
  precision: GeocodePrecision;
}

export interface GeocodeQuery {
  precision: GeocodePrecision;
  q: string;
}

const UNIT_DESIGNATOR_PATTERN =
  /[\s,]+(?:(?:ste|suite|unit|apt|apartment|bldg|building|fl|floor|rm|room|spc|space)\b\.?\s*#?\s*(?:[A-Za-z]\b|\d[\w-]*)|#\s*[\w-]+)(?:[\s,].*)?$/i;
/** Trailing lone letter that is a unit ("... Rd A"); N/S/E/W are directionals, kept. */
const TRAILING_UNIT_LETTER_PATTERN = /\s+[A-DF-MO-RT-VX-Za-df-mo-rt-vx-z]$/;

/**
 * Unit/suite designators make Nominatim miss ("7447 N MacArthur Blvd Ste
 * 150" returns nothing, "7447 N MacArthur Blvd" resolves — found in live
 * testing). Strips "Ste 150", "Suite 190", "#135", "Unit 4", "Apt 2B",
 * "Bldg C", "Fl 2" (and anything after them) plus a trailing lone letter
 * ("833 E Shady Grove Rd A"). The unit id after a word designator must look
 * like an id (a single letter, or something starting with a digit) so a
 * street like "Space Center Blvd" is untouched; a trailing N/S/E/W is a
 * directional ("Main St W"), not a unit, so it is kept.
 */
export function stripUnitDesignators(street: string): string {
  const out = street
    .trim()
    .replace(UNIT_DESIGNATOR_PATTERN, "")
    .replace(TRAILING_UNIT_LETTER_PATTERN, "");
  return out.replace(/[\s,]+$/, "").trim();
}

/**
 * Fallback chain, most to least specific: full address, then street +
 * city + state (drops a ZIP that may be wrong/new), then ZIP + state
 * (approximate centroid, better than an invisible listing). All are
 * free-form `q` queries (structured postalcode= returned [] in live
 * testing) built from the unit-stripped street.
 */
export function buildGeocodeQueries(address: GeocodeAddress): GeocodeQuery[] {
  const street = stripUnitDesignators(address.address_line1);
  const city = address.city.trim();
  const state = address.state.trim().toUpperCase();
  const zip = address.postal_code.trim();

  const queries: GeocodeQuery[] = [];
  if (street && city && state && zip) {
    queries.push({ precision: "address", q: `${street}, ${city}, ${state} ${zip}` });
  }
  if (street && city && state) {
    queries.push({ precision: "street", q: `${street}, ${city}, ${state}` });
  }
  if (zip && state) {
    queries.push({ precision: "postal_code", q: `${zip}, ${state}` });
  }
  return queries;
}

// Rough bounding boxes for the US: contiguous states, Alaska, Hawaii.
// Catches a wrong-country or wildly-off match; not a precise border test.
const US_BOUNDING_BOXES: ReadonlyArray<{
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}> = [
  { minLat: 24.3, maxLat: 49.5, minLng: -125.1, maxLng: -66.8 },
  { minLat: 51.0, maxLat: 71.6, minLng: -180, maxLng: -129.9 },
  { minLat: 18.8, maxLat: 22.4, minLng: -160.6, maxLng: -154.7 },
];

export function isPlausibleUsCoordinate(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return US_BOUNDING_BOXES.some(
    (box) =>
      latitude >= box.minLat &&
      latitude <= box.maxLat &&
      longitude >= box.minLng &&
      longitude <= box.maxLng
  );
}

/** Extracts the first plausible {lat, lon} from a Nominatim `format=json` response body, else null. */
export function parseNominatimResponse(
  body: unknown
): { latitude: number; longitude: number } | null {
  if (!Array.isArray(body)) return null;
  for (const entry of body) {
    if (typeof entry !== "object" || entry === null) continue;
    const { lat, lon } = entry as { lat?: unknown; lon?: unknown };
    const latitude = typeof lat === "string" || typeof lat === "number" ? Number(lat) : NaN;
    const longitude = typeof lon === "string" || typeof lon === "number" ? Number(lon) : NaN;
    if (isPlausibleUsCoordinate(latitude, longitude)) {
      // LocationCreate stores 6 decimal places (~0.1 m); no point sending more.
      return {
        latitude: Math.round(latitude * 1e6) / 1e6,
        longitude: Math.round(longitude * 1e6) / 1e6,
      };
    }
  }
  return null;
}
