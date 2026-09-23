// Unit tests for the admin Owners report's URL/query helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnersHref,
  parseOwnerSearch,
  parseOwnerSort,
  parsePage,
} from "./adminOwnersView.ts";

test("parseOwnerSort accepts the four API values and falls back to newest", () => {
  assert.equal(parseOwnerSort("oldest"), "oldest");
  assert.equal(parseOwnerSort("most_locations"), "most_locations");
  assert.equal(parseOwnerSort("email"), "email");
  assert.equal(parseOwnerSort("newest"), "newest");
  assert.equal(parseOwnerSort("bogus"), "newest");
  assert.equal(parseOwnerSort(undefined), "newest");
});

test("parseOwnerSearch trims, caps at 100 chars and drops blanks", () => {
  assert.equal(parseOwnerSearch("  priya  "), "priya");
  assert.equal(parseOwnerSearch("   "), undefined);
  assert.equal(parseOwnerSearch(undefined), undefined);
  assert.equal(parseOwnerSearch("x".repeat(150))?.length, 100);
});

test("parsePage only accepts positive integers", () => {
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("-2"), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage(undefined), 1);
});

test("buildOwnersHref omits defaults and encodes the search term", () => {
  assert.equal(buildOwnersHref({}), "/admin/owners");
  assert.equal(buildOwnersHref({ page: 1, sort: "newest" }), "/admin/owners");
  assert.equal(buildOwnersHref({ page: 2 }), "/admin/owners?page=2");
  assert.equal(
    buildOwnersHref({ q: "a&b c", sort: "email", page: 3 }),
    "/admin/owners?q=a%26b+c&sort=email&page=3"
  );
});
