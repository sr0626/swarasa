// Unit tests for the geocoding core (address cleaning, response parsing,
// provider chain with a fake fetch) plus the phone/timezone helpers. The
// frontend has no test framework; run with Node's built-in runner:
//   cd frontend && npm run test:unit
// (excluded from `tsc` via tsconfig.json — it imports with a .ts extension
// so Node can resolve it without a bundler.)
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCensusUrl,
  buildNominatimQueries,
  formatOneLineAddress,
  geocodeWithProviders,
  isPlausibleUsCoordinate,
  parseCensusResponse,
  parseNominatimResponse,
  stripUnitDesignators,
  type FetchLike,
  type GeocodeAddress,
  type GeocodeDeps,
} from "./geocoder.ts";
import { normalizePhone } from "../phone.ts";
import { timezoneForState } from "../timezone.ts";

test("stripUnitDesignators removes suite/unit tokens", () => {
  const cases: Array<[string, string]> = [
    ["7447 N MacArthur Blvd Ste 150", "7447 N MacArthur Blvd"],
    ["100 Main St #135", "100 Main St"],
    ["200 Elm St, Suite 190", "200 Elm St"],
    ["833 E Shady Grove Rd A", "833 E Shady Grove Rd"],
    ["500 Oak Ave Apt 2B", "500 Oak Ave"],
    ["600 Pine St Unit 4 Rear", "600 Pine St"],
    ["700 Ridge Rd Bldg C", "700 Ridge Rd"],
    ["800 Maple Dr Fl 2", "800 Maple Dr"],
    ["1000 N Central Expy #100-B", "1000 N Central Expy"],
    // Untouched: plain streets, directionals, streets named like designators.
    ["123 Main Street", "123 Main Street"],
    ["400 Main St W", "400 Main St W"],
    ["300 Space Center Blvd", "300 Space Center Blvd"],
    ["55 Floor Mill Rd", "55 Floor Mill Rd"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(stripUnitDesignators(input), expected, input);
  }
});

const ADDRESS: GeocodeAddress = {
  address_line1: "7447 N MacArthur Blvd Ste 150",
  city: "Irving",
  state: "tx",
  postal_code: "75063",
};

test("buildNominatimQueries builds the ordered fallback chain from the stripped street", () => {
  assert.deepEqual(buildNominatimQueries(ADDRESS), [
    { precision: "address", q: "7447 N MacArthur Blvd, Irving, TX 75063" },
    { precision: "street", q: "7447 N MacArthur Blvd, Irving, TX" },
    { precision: "postal_code", q: "75063, TX" },
  ]);
  assert.deepEqual(
    buildNominatimQueries({ address_line1: "", city: "Plano", state: "TX", postal_code: "75024" }),
    [{ precision: "postal_code", q: "75024, TX" }]
  );
});

test("Census request building", () => {
  assert.equal(
    formatOneLineAddress("7447 N MacArthur Blvd Ste 150", ADDRESS),
    "7447 N MacArthur Blvd Ste 150, Irving, TX 75063"
  );
  const url = new URL(buildCensusUrl("100 Main St #135, Irving, TX 75063"));
  assert.equal(url.origin + url.pathname, "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  assert.equal(url.searchParams.get("address"), "100 Main St #135, Irving, TX 75063");
  assert.equal(url.searchParams.get("benchmark"), "Public_AR_Current");
  assert.equal(url.searchParams.get("format"), "json");
});

test("isPlausibleUsCoordinate", () => {
  assert.equal(isPlausibleUsCoordinate(32.85, -96.9), true); // DFW
  assert.equal(isPlausibleUsCoordinate(61.2, -149.9), true); // Anchorage
  assert.equal(isPlausibleUsCoordinate(21.3, -157.8), true); // Honolulu
  assert.equal(isPlausibleUsCoordinate(51.5, -0.1), false); // London
  assert.equal(isPlausibleUsCoordinate(0, 0), false);
  assert.equal(isPlausibleUsCoordinate(Number.NaN, -96), false);
  assert.equal(isPlausibleUsCoordinate(32, Number.POSITIVE_INFINITY), false);
});

test("parseNominatimResponse", () => {
  assert.deepEqual(parseNominatimResponse([{ lat: "32.8537421", lon: "-96.9005123" }]), {
    latitude: 32.853742,
    longitude: -96.900512,
  });
  assert.equal(parseNominatimResponse([]), null);
  assert.equal(parseNominatimResponse({ error: "x" }), null);
  assert.equal(parseNominatimResponse([{ lat: "abc", lon: "-96.9" }]), null);
  assert.equal(parseNominatimResponse([{ lat: "51.5", lon: "-0.1" }]), null);
  assert.equal(parseNominatimResponse([null, 3, { lat: null }]), null);
});

test("parseCensusResponse (x = longitude, y = latitude)", () => {
  assert.deepEqual(
    parseCensusResponse({
      result: { addressMatches: [{ coordinates: { x: -96.9005123, y: 32.8537421 } }] },
    }),
    { latitude: 32.853742, longitude: -96.900512 }
  );
  assert.equal(parseCensusResponse({ result: { addressMatches: [] } }), null);
  assert.equal(parseCensusResponse({ result: {} }), null);
  assert.equal(parseCensusResponse(null), null);
  assert.equal(parseCensusResponse("nope"), null);
  // Implausible (0,0) and swapped axes are rejected.
  assert.equal(parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: 0, y: 0 } }] } }), null);
  assert.equal(
    parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: 32.85, y: -96.9 } }] } }),
    null
  );
});

// --- provider chain with a fake fetch -------------------------------------

interface Call {
  url: string;
  userAgent: string | undefined;
}

type Responder = (url: URL) => { status?: number; body?: unknown } | "throw";

function makeDeps(responder: Responder): { deps: GeocodeDeps; calls: Call[]; sleeps: number[] } {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, userAgent: init.headers["User-Agent"] });
    clock += 200;
    const out = responder(new URL(url));
    if (out === "throw") throw new Error("network down");
    const status = out.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => out.body };
  };
  const deps: GeocodeDeps = {
    fetchFn,
    userAgent: "Swarasa-test",
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, sleeps };
}

const censusHit = { result: { addressMatches: [{ coordinates: { x: -96.9, y: 32.85 } }] } };
const censusMiss = { result: { addressMatches: [] } };
const isCensus = (u: URL) => u.hostname === "geocoding.geo.census.gov";

test("chain: Census hit is returned without touching Nominatim", async () => {
  const { deps, calls } = makeDeps(() => ({ body: censusHit }));
  const result = await geocodeWithProviders(ADDRESS, deps);
  assert.deepEqual(result, { latitude: 32.85, longitude: -96.9, precision: "address", source: "census" });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /Ste\+150|Ste%20150/); // Census gets the address as typed
});

test("chain: Census miss on the raw address retries Census with the unit stripped", async () => {
  const { deps, calls } = makeDeps((url) => {
    if (isCensus(url) && /Ste/.test(url.searchParams.get("address") ?? "")) return { body: censusMiss };
    return { body: censusHit };
  });
  const result = await geocodeWithProviders(ADDRESS, deps);
  assert.equal(result?.source, "census");
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]!.url).searchParams.get("address"), "7447 N MacArthur Blvd, Irving, TX 75063");
});

test("chain: address without a unit makes a single Census attempt before falling back", async () => {
  const plain = { ...ADDRESS, address_line1: "123 Main St" };
  const { deps, calls } = makeDeps((url) =>
    isCensus(url) ? { body: censusMiss } : { body: [{ lat: "32.9", lon: "-96.8" }] }
  );
  const result = await geocodeWithProviders(plain, deps);
  assert.equal(result?.source, "nominatim");
  assert.equal(result?.precision, "address");
  assert.equal(calls.filter((c) => isCensus(new URL(c.url))).length, 1);
  assert.equal(calls.at(-1)!.userAgent, "Swarasa-test");
});

test("chain: Census network error falls through to Nominatim (unit-stripped street)", async () => {
  const { deps, calls } = makeDeps((url) =>
    isCensus(url) ? "throw" : { body: [{ lat: "32.9", lon: "-96.8" }] }
  );
  const result = await geocodeWithProviders(ADDRESS, deps);
  assert.equal(result?.source, "nominatim");
  const nominatim = calls.filter((c) => !isCensus(new URL(c.url)));
  assert.equal(nominatim.length, 1);
  assert.equal(new URL(nominatim[0]!.url).searchParams.get("q"), "7447 N MacArthur Blvd, Irving, TX 75063");
});

test("chain: Nominatim 429 is treated as no match and never retried", async () => {
  const { deps, calls } = makeDeps((url) => (isCensus(url) ? { body: censusMiss } : { status: 429 }));
  const result = await geocodeWithProviders(ADDRESS, deps);
  assert.equal(result, null);
  assert.equal(calls.filter((c) => !isCensus(new URL(c.url))).length, 1);
});

test("chain: Nominatim fallbacks are spaced >= 1s apart and end at ZIP centroid", async () => {
  const { deps, calls, sleeps } = makeDeps((url) => {
    if (isCensus(url)) return { body: censusMiss };
    return { body: url.searchParams.get("q") === "75063, TX" ? [{ lat: "32.9", lon: "-96.9" }] : [] };
  });
  const result = await geocodeWithProviders(ADDRESS, deps);
  assert.equal(result?.precision, "postal_code");
  assert.equal(calls.filter((c) => !isCensus(new URL(c.url))).length, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every((ms) => ms >= 1000));
});

test("chain: every provider misses or returns implausible coordinates -> null", async () => {
  const { deps } = makeDeps((url) =>
    isCensus(url)
      ? { body: { result: { addressMatches: [{ coordinates: { x: 0, y: 0 } }] } } }
      : { body: [{ lat: "51.5", lon: "-0.1" }] }
  );
  assert.equal(await geocodeWithProviders(ADDRESS, deps), null);
});

test("chain: HTTP 500 and bad JSON are misses, not exceptions", async () => {
  const { deps } = makeDeps((url) => (isCensus(url) ? { status: 500 } : { body: "<html>" }));
  assert.equal(await geocodeWithProviders(ADDRESS, deps), null);
});

test("chain: no request is made once the time budget is spent", async () => {
  // Every request "takes" 9s of fake clock, so after one attempt the budget is gone.
  let clock = 0;
  let requests = 0;
  const deps: GeocodeDeps = {
    fetchFn: async () => {
      requests++;
      clock += 9_000;
      return { ok: true, status: 200, json: async () => censusMiss };
    },
    userAgent: "t",
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  assert.equal(await geocodeWithProviders(ADDRESS, deps), null);
  assert.equal(requests, 1);
});

test("normalizePhone", () => {
  const cases: Array<[string, string | null]> = [
    ["(972) 555-0142", "+19725550142"],
    ["972-555-0142", "+19725550142"],
    ["972.555.0142", "+19725550142"],
    ["1 972 555 0142", "+19725550142"],
    ["+1 (972) 555-0142", "+19725550142"],
    ["+44 20 7946 0958", "+442079460958"],
    ["", null],
    ["555-0142", null],
    ["(072) 555-0142", null],
    ["+1 972 555", null],
    ["not a phone", null],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizePhone(input), expected, input);
  }
});

test("timezoneForState", () => {
  assert.equal(timezoneForState("tx"), "America/Chicago");
  assert.equal(timezoneForState("NJ"), "America/New_York");
  assert.equal(timezoneForState("CA"), "America/Los_Angeles");
  assert.equal(timezoneForState("ZZ"), "America/Chicago");
});
