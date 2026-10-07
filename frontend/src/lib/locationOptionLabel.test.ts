import test from "node:test";
import assert from "node:assert/strict";
import { locationOptionLabel } from "./locationOptionLabel.ts";

test("label includes the location name when there is one", () => {
  assert.equal(
    locationOptionLabel("Spice Garden", {
      location_name: "Downtown",
      address_line1: "1 Main St",
      city: "Irving",
    }),
    "Spice Garden — Downtown, 1 Main St, Irving"
  );
});

test("label omits the dash when the location has no name", () => {
  assert.equal(
    locationOptionLabel("Spice Garden", {
      location_name: null,
      address_line1: "1 Main St",
      city: "Irving",
    }),
    "Spice Garden, 1 Main St, Irving"
  );
});
