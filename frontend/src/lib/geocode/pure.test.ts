// Unit tests for the pure geocoding helpers. The frontend has no test
// framework; run with Node's built-in runner:
//   cd frontend && npm run test:unit
// (excluded from `tsc` via tsconfig.json — it imports with a .ts extension
// so Node can resolve it without a bundler.)
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeocodeQueries,
  isPlausibleUsCoordinate,
  parseNominatimResponse,
  stripUnitDesignators,
} from "./pure.ts";
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

test("buildGeocodeQueries builds the ordered fallback chain from the stripped street", () => {
  const queries = buildGeocodeQueries({
    address_line1: "7447 N MacArthur Blvd Ste 150",
    city: "Irving",
    state: "tx",
    postal_code: "75063",
  });
  assert.deepEqual(queries, [
    { precision: "address", q: "7447 N MacArthur Blvd, Irving, TX 75063" },
    { precision: "street", q: "7447 N MacArthur Blvd, Irving, TX" },
    { precision: "postal_code", q: "75063, TX" },
  ]);
});

test("buildGeocodeQueries skips levels with missing parts", () => {
  assert.deepEqual(
    buildGeocodeQueries({ address_line1: "", city: "Plano", state: "TX", postal_code: "75024" }),
    [{ precision: "postal_code", q: "75024, TX" }]
  );
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
