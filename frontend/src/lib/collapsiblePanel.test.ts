// Unit tests for the CollapsiblePanel pure helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  countAppliedFilters,
  filtersHint,
  panelStorageKey,
  parseStoredOpen,
  storedValueFor,
} from "./collapsiblePanel.ts";

test("panelStorageKey is page + panel scoped and sanitised", () => {
  assert.equal(panelStorageKey("users", "summary"), "swarasa:panel:users:summary");
  assert.notEqual(panelStorageKey("users", "summary"), panelStorageKey("owners", "summary"));
  assert.notEqual(panelStorageKey("users", "summary"), panelStorageKey("users", "search"));
  assert.equal(
    panelStorageKey(" Audit Log ", "Search/Filters"),
    "swarasa:panel:audit-log:search-filters"
  );
  assert.equal(panelStorageKey("", "!!"), "swarasa:panel:x:x");
});

test("parseStoredOpen only trusts the two known values", () => {
  assert.equal(parseStoredOpen("open"), true);
  assert.equal(parseStoredOpen("closed"), false);
  assert.equal(parseStoredOpen(null), null);
  assert.equal(parseStoredOpen(undefined), null);
  assert.equal(parseStoredOpen("true"), null);
  assert.equal(parseStoredOpen(""), null);
  assert.equal(parseStoredOpen(storedValueFor(true)), true);
  assert.equal(parseStoredOpen(storedValueFor(false)), false);
});

test("countAppliedFilters ignores empty values and defaults", () => {
  assert.equal(countAppliedFilters({}), 0);
  assert.equal(countAppliedFilters({ q: undefined, role: "", status: "  " }), 0);
  assert.equal(countAppliedFilters({ q: "raj", role: "owner" }), 2);
  assert.equal(countAppliedFilters({ q: undefined, sort: "newest" }, { sort: "newest" }), 0);
  assert.equal(countAppliedFilters({ sort: "oldest" }, { sort: "newest" }), 1);
});

test("countAppliedFilters counts false and 0 as real values", () => {
  assert.equal(countAppliedFilters({ isPaid: false, isClaimed: undefined }), 1);
  assert.equal(countAppliedFilters({ ownerId: 0 }), 1);
  assert.equal(countAppliedFilters({ a: null }), 0);
});

test("filtersHint: none, search text only, or a count", () => {
  assert.equal(filtersHint(0, "x"), null);
  assert.equal(filtersHint(1, "biryani"), "“biryani”");
  assert.equal(filtersHint(1), "1 applied");
  assert.equal(filtersHint(2, "biryani"), "2 applied");
  assert.equal(filtersHint(1, "   "), "1 applied");
  assert.match(filtersHint(1, "a".repeat(60)) ?? "", /^“a{23}…”$/);
});
