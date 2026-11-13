// Unit tests for the admin Listings brand-card layout helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_RESTAURANT_LABEL,
  EDIT_LOCATION_LABEL,
  NO_LOCATIONS_LABEL,
  brandLayout,
  brandMetaLine,
  childLocationText,
  locationsHeading,
  locationsToggleLabel,
  mergedLocationText,
  sameProvenance,
} from "./adminListingLayout.ts";

test("brandLayout: 0 -> empty, 1 -> single, 2+ -> multi", () => {
  assert.equal(brandLayout(0), "empty");
  assert.equal(brandLayout(1), "single");
  assert.equal(brandLayout(2), "multi");
  assert.equal(brandLayout(7), "multi");
});

test("filtered subset: 3 total locations, 1 matching is still multi (total count decides)", () => {
  const locations = [{ matches_filter: true }, { matches_filter: false }, { matches_filter: false }];
  assert.equal(brandLayout(locations.length), "multi");
  // Counting only the matching subset would wrongly collapse it to a single card.
  assert.notEqual(brandLayout(locations.filter((l) => l.matches_filter).length), "multi");
});

test("scoped labels", () => {
  assert.equal(DELETE_RESTAURANT_LABEL, "Delete restaurant");
  assert.equal(EDIT_LOCATION_LABEL, "Edit location");
  assert.equal(NO_LOCATIONS_LABEL, "No locations yet");
});

test("locationsHeading and toggle label", () => {
  assert.equal(locationsHeading(3), "Locations (3)");
  assert.equal(locationsToggleLabel(false, 3), "Show locations (3)");
  assert.equal(locationsToggleLabel(true, 3), "Hide locations");
});

test("brandMetaLine shows location counts only for multi-location brands", () => {
  const base = { slug: "zz", follower_count: 1, location_count: 1 };
  assert.equal(brandMetaLine({ ...base, totalLocations: 1 }), "/zz · 1 follower");
  assert.equal(
    brandMetaLine({ ...base, totalLocations: 0, location_count: 0, follower_count: 0 }),
    "/zz · 0 followers"
  );
  assert.equal(
    brandMetaLine({ ...base, totalLocations: 3, location_count: 2, follower_count: 4 }),
    "/zz · 2 active of 3 locations · 4 followers"
  );
});

const loc = {
  location_name: null,
  address_line1: "4107 Test Lane",
  address_line2: "Suite 4",
  city: "Plano",
  state: "TX",
  postal_code: "75024",
};

test("childLocationText shows the street once for an unnamed location", () => {
  const { title, detail } = childLocationText(loc);
  assert.equal(title, "Location · 4107 Test Lane");
  assert.equal(detail, "Suite 4, Plano, TX 75024");
  assert.ok(!detail.includes("4107 Test Lane"));
});

test("childLocationText with a name keeps the full address in the detail only", () => {
  const { title, detail } = childLocationText({ ...loc, location_name: "Downtown" });
  assert.equal(title, "Location · Downtown");
  assert.equal(detail, "4107 Test Lane, Suite 4, Plano, TX 75024");
  // A name equal to the street is treated as unnamed.
  assert.equal(
    childLocationText({ ...loc, location_name: "4107 Test Lane" }).title,
    "Location · 4107 Test Lane"
  );
});

test("childLocationText tolerates missing parts", () => {
  const { detail } = childLocationText({ ...loc, address_line2: null, postal_code: "" });
  assert.equal(detail, "Plano, TX");
});

test("mergedLocationText returns the full address once, name only when distinct", () => {
  assert.deepEqual(mergedLocationText(loc), {
    name: null,
    address: "4107 Test Lane, Suite 4, Plano, TX 75024",
  });
  assert.equal(mergedLocationText({ ...loc, location_name: "Downtown" }).name, "Downtown");
});

test("sameProvenance compares day and actor", () => {
  const a = { created_at: "2026-11-01T10:00:00Z", created_by_role: "admin", created_by_label: "root@x.com" };
  assert.equal(sameProvenance(a, { ...a, created_at: "2026-11-01T23:00:00Z" }), true);
  assert.equal(sameProvenance(a, { ...a, created_at: "2026-11-02T00:00:00Z" }), false);
  assert.equal(sameProvenance(a, { ...a, created_by_label: "import" }), false);
});
