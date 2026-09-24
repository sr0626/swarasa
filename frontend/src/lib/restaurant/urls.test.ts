// Unit tests for the restaurant URL helpers and the canonical-path rule.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  brandHref,
  canonicalPath,
  locationDealsHref,
  locationHref,
  reportHref,
} from "./urls.ts";

test("brandHref and locationHref build the two public URL shapes", () => {
  assert.equal(brandHref("namaste-grill"), "/restaurant/namaste-grill");
  assert.equal(locationHref("namaste-grill", "irving"), "/restaurant/namaste-grill/irving");
});

test("locationDealsHref lands on the deals anchor of the LOCATION page", () => {
  assert.equal(
    locationDealsHref("namaste-grill", "irving-800-n-belt-line"),
    "/restaurant/namaste-grill/irving-800-n-belt-line#deals"
  );
});

test("reportHref is brand-level, optionally pre-selecting a location", () => {
  assert.equal(reportHref("namaste-grill"), "/restaurant/namaste-grill/report");
  assert.equal(reportHref("namaste-grill", 42), "/restaurant/namaste-grill/report?location=42");
  assert.equal(reportHref("namaste-grill", null), "/restaurant/namaste-grill/report");
});

test("canonicalPath: a single-active-location brand canonicalises to the short brand URL", () => {
  assert.equal(
    canonicalPath({
      brandSlug: "namaste-grill",
      locationSlug: "irving",
      activeLocationCount: 1,
      isActive: true,
    }),
    "/restaurant/namaste-grill"
  );
});

test("canonicalPath: several active locations keep their own long URL", () => {
  assert.equal(
    canonicalPath({
      brandSlug: "namaste-grill",
      locationSlug: "irving",
      activeLocationCount: 3,
      isActive: true,
    }),
    "/restaurant/namaste-grill/irving"
  );
});

test("canonicalPath: a hidden location being previewed never claims the brand URL", () => {
  assert.equal(
    canonicalPath({
      brandSlug: "namaste-grill",
      locationSlug: "plano",
      activeLocationCount: 1,
      isActive: false,
    }),
    "/restaurant/namaste-grill/plano"
  );
  // A brand whose only location is hidden has 0 active locations.
  assert.equal(
    canonicalPath({
      brandSlug: "namaste-grill",
      locationSlug: "plano",
      activeLocationCount: 0,
      isActive: false,
    }),
    "/restaurant/namaste-grill/plano"
  );
});
