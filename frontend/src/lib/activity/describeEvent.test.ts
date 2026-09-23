// Unit tests for the admin activity-view display helpers. Run with:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { describeResultCount, describeSearch, sourceLabel } from "./describeEvent.ts";

test("describeSearch lists each recorded criterion in a stable order", () => {
  assert.deepEqual(
    describeSearch({
      q: "biryani",
      cuisine: ["north_indian", "hyderabadi"],
      dietary: ["vegetarian"],
      type: ["fine_dining"],
      loc: "Irving, TX",
      has_deals_today: true,
      result_count: 4,
    }),
    [
      "Text: “biryani”",
      "Cuisine: north indian, hyderabadi",
      "Dietary: vegetarian",
      "Type: fine dining",
      "Location: Irving, TX",
      "Deals today only",
    ]
  );
});

test("describeSearch is defensive about an empty payload", () => {
  assert.deepEqual(describeSearch({}), ["No details recorded"]);
});

test("describeResultCount pluralises and handles missing", () => {
  assert.equal(describeResultCount(0), "0 results");
  assert.equal(describeResultCount(1), "1 result");
  assert.equal(describeResultCount(12), "12 results");
  assert.equal(describeResultCount(undefined), null);
});

test("sourceLabel maps known surfaces and passes unknown ones through", () => {
  assert.equal(sourceLabel("search_results"), "Search results");
  assert.equal(sourceLabel("homepage"), "Homepage");
  assert.equal(sourceLabel("favourites"), "Favourites");
  assert.equal(sourceLabel("future_surface"), "future_surface");
});
