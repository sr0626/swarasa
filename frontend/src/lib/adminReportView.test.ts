// Unit tests for the shared admin report URL/query helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGER_SORTS,
  REGISTERED_USER_SORTS,
  buildReportHref,
  parsePage,
  parseSearch,
  parseSort,
} from "./adminReportView.ts";

test("parseSort accepts every API value and falls back to the default", () => {
  for (const sort of REGISTERED_USER_SORTS) {
    assert.equal(parseSort(sort, REGISTERED_USER_SORTS, "newest"), sort);
  }
  for (const sort of MANAGER_SORTS) {
    assert.equal(parseSort(sort, MANAGER_SORTS, "newest"), sort);
  }
  assert.equal(parseSort("bogus", REGISTERED_USER_SORTS, "newest"), "newest");
  assert.equal(parseSort(undefined, REGISTERED_USER_SORTS, "newest"), "newest");
  // A manager-only sort is not valid for registered users.
  assert.equal(parseSort("most_locations", REGISTERED_USER_SORTS, "newest"), "newest");
});

test("parseSearch trims, caps at 100 chars and drops blanks", () => {
  assert.equal(parseSearch("  priya  "), "priya");
  assert.equal(parseSearch("   "), undefined);
  assert.equal(parseSearch(undefined), undefined);
  assert.equal(parseSearch("x".repeat(150))?.length, 100);
});

test("parsePage only accepts positive integers", () => {
  assert.equal(parsePage("3"), 3);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("-2"), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage(undefined), 1);
});

test("buildReportHref omits defaults and keeps search/sort across pages", () => {
  assert.equal(buildReportHref("/admin/managers", {}, "newest"), "/admin/managers");
  assert.equal(
    buildReportHref("/admin/managers", { page: 1, sort: "newest" }, "newest"),
    "/admin/managers"
  );
  assert.equal(
    buildReportHref("/admin/managers", { q: "a&b c", sort: "email", page: 3 }, "newest"),
    "/admin/managers?q=a%26b+c&sort=email&page=3"
  );
  assert.equal(
    buildReportHref("/admin/registered-users", { sort: "last_seen" }, "newest"),
    "/admin/registered-users?sort=last_seen"
  );
});
