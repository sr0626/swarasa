// Geocoding core: address cleaning, provider request building/parsing, and
// the provider chain (US Census Geocoder first, OpenStreetMap Nominatim as
// fallback). Dependency-free — the network, sleep and clock are injected
// (`GeocodeDeps`) — so everything here is unit-testable with `node --test`
// and a fake fetch, without the "@/..." path alias (see geocoder.test.ts).
// The real wiring (global fetch, User-Agent) is in ./index.ts.
//
// Why a server-side geocoder at all: the API Lambda has no internet access
// (no NAT Gateway), so the Next.js server actions (Amplify SSR compute,
// which does have internet) geocode and pass lat/lng to POST/PATCH
// /locations.
//
// Provider order (decided after live testing):
//   1. US Census Geocoder — free, no key, US-only, and it resolves
//      suite-suffixed addresses ("Ste 150", "#135") that Nominatim misses.
//      Tried with the address as typed, then with unit tokens stripped.
//   2. Nominatim — only if Census found nothing. It rate-limits (429) and
//      chokes on unit tokens, so it only ever sees the unit-stripped
//      street, a 429 counts as "no match" (never retried), and requests to
//      it are spaced >= 1s apart per its usage policy.
//
// Failure is never fatal: every failure mode (timeout, HTTP error, bad
// JSON, no match, implausible result) yields null and the caller creates
// the listing without coordinates. Nothing is ever fabricated.

export interface GeocodeAddress {
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
}

export type GeocodePrecision = "address" | "street" | "postal_code";
export type GeocodeSource = "census" | "nominatim";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** "postal_code" is only an approximate (ZIP-area) position. */
  precision: GeocodePrecision;
  source: GeocodeSource;
}

// ---------------------------------------------------------------------------
// Address cleaning
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// US plausibility + response parsing
// ---------------------------------------------------------------------------

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

interface LatLng {
  latitude: number;
  longitude: number;
}

function toCoordinate(latRaw: unknown, lngRaw: unknown): LatLng | null {
  const isNum = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";
  const latitude = isNum(latRaw) ? Number(latRaw) : NaN;
  const longitude = isNum(lngRaw) ? Number(lngRaw) : NaN;
  if (!isPlausibleUsCoordinate(latitude, longitude)) return null;
  // LocationCreate stores 6 decimal places (~0.1 m); no point sending more.
  return {
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
  };
}

/** First plausible {lat, lon} from a Nominatim `format=json` body, else null. */
export function parseNominatimResponse(body: unknown): LatLng | null {
  if (!Array.isArray(body)) return null;
  for (const entry of body) {
    if (typeof entry !== "object" || entry === null) continue;
    const { lat, lon } = entry as { lat?: unknown; lon?: unknown };
    const hit = toCoordinate(lat, lon);
    if (hit) return hit;
  }
  return null;
}

/**
 * First plausible match from a US Census `onelineaddress` body:
 * `result.addressMatches[].coordinates` with x = longitude, y = latitude.
 * An empty `addressMatches` means no match.
 */
export function parseCensusResponse(body: unknown): LatLng | null {
  if (typeof body !== "object" || body === null) return null;
  const result = (body as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return null;
  const matches = (result as { addressMatches?: unknown }).addressMatches;
  if (!Array.isArray(matches)) return null;
  for (const match of matches) {
    if (typeof match !== "object" || match === null) continue;
    const coordinates = (match as { coordinates?: unknown }).coordinates;
    if (typeof coordinates !== "object" || coordinates === null) continue;
    const { x, y } = coordinates as { x?: unknown; y?: unknown };
    const hit = toCoordinate(y, x);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Free-form "street, city, ST ZIP" (ZIP omitted when blank). */
export function formatOneLineAddress(street: string, address: GeocodeAddress): string {
  const city = address.city.trim();
  const state = address.state.trim().toUpperCase();
  const zip = address.postal_code.trim();
  return `${street.trim()}, ${city}, ${[state, zip].filter(Boolean).join(" ")}`;
}

export function buildCensusUrl(oneLineAddress: string): string {
  const url = new URL(CENSUS_URL);
  url.searchParams.set("address", oneLineAddress);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  return url.toString();
}

export function buildNominatimUrl(q: string): string {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", q);
  return url.toString();
}

/**
 * Nominatim fallback chain, most to least specific, all free-form `q` on
 * the unit-stripped street (structured `postalcode=` returned [] in live
 * testing): full address, street + city + state (drops a ZIP that may be
 * wrong/new), then ZIP + state (approximate centroid — better than an
 * invisible listing, but unverified against the live service).
 */
export function buildNominatimQueries(
  address: GeocodeAddress
): Array<{ precision: GeocodePrecision; q: string }> {
  const street = stripUnitDesignators(address.address_line1);
  const city = address.city.trim();
  const state = address.state.trim().toUpperCase();
  const zip = address.postal_code.trim();

  const queries: Array<{ precision: GeocodePrecision; q: string }> = [];
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

// ---------------------------------------------------------------------------
// Provider chain
// ---------------------------------------------------------------------------

/** The slice of `fetch` this module uses; the real global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; cache: "no-store" }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface GeocodeDeps {
  fetchFn: FetchLike;
  /** Sent to Nominatim (usage policy requires an identifying contact). */
  userAgent: string;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const REQUEST_TIMEOUT_MS = 4_000;
/** Whole-lookup budget across every provider attempt. */
const TOTAL_BUDGET_MS = 12_000;
/** Nominatim policy: max 1 request/second. */
const NOMINATIM_MIN_SPACING_MS = 1_100;

type FetchOutcome = { kind: "ok"; body: unknown } | { kind: "rate_limited" } | { kind: "miss" };

async function fetchJson(
  deps: GeocodeDeps,
  url: string,
  headers: Record<string, string>
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Owner-entered addresses; never serve from / write to Next's data cache.
    const res = await deps.fetchFn(url, {
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 429) return { kind: "rate_limited" };
    if (!res.ok) return { kind: "miss" };
    return { kind: "ok", body: await res.json() };
  } catch {
    return { kind: "miss" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort geocode; resolves to null (never throws) when no provider
 * yields a plausible US position within the time budget.
 */
export async function geocodeWithProviders(
  address: GeocodeAddress,
  deps: GeocodeDeps
): Promise<GeocodeResult | null> {
  const started = deps.now();
  const hasBudget = () => deps.now() - started + REQUEST_TIMEOUT_MS <= TOTAL_BUDGET_MS;

  // 1. Census: as typed, then unit-stripped (only if that differs).
  const rawStreet = address.address_line1.trim();
  const strippedStreet = stripUnitDesignators(rawStreet);
  const censusStreets = [rawStreet];
  if (strippedStreet && strippedStreet !== rawStreet) censusStreets.push(strippedStreet);

  if (address.city.trim() && address.state.trim()) {
    for (const street of censusStreets) {
      if (!street || !hasBudget()) break;
      const outcome = await fetchJson(
        deps,
        buildCensusUrl(formatOneLineAddress(street, address)),
        {}
      );
      if (outcome.kind === "ok") {
        const hit = parseCensusResponse(outcome.body);
        if (hit) return { ...hit, precision: "address", source: "census" };
      }
    }
  }

  // 2. Nominatim fallback.
  let firstNominatimRequest = true;
  for (const query of buildNominatimQueries(address)) {
    if (!hasBudget()) break;
    if (!firstNominatimRequest) {
      if (deps.now() - started + NOMINATIM_MIN_SPACING_MS + REQUEST_TIMEOUT_MS > TOTAL_BUDGET_MS) {
        break;
      }
      await deps.sleep(NOMINATIM_MIN_SPACING_MS);
    }
    firstNominatimRequest = false;

    const outcome = await fetchJson(deps, buildNominatimUrl(query.q), {
      "User-Agent": deps.userAgent,
    });
    // 429: the service is telling us to back off — treat as no match and
    // stop, never retry in a loop.
    if (outcome.kind === "rate_limited") break;
    if (outcome.kind === "ok") {
      const hit = parseNominatimResponse(outcome.body);
      if (hit) return { ...hit, precision: query.precision, source: "nominatim" };
    }
  }

  return null;
}
