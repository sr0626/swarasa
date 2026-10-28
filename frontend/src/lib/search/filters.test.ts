// Unit tests for the "Deals today" search filter's URL contract.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchHref,
  countFilters,
  EMPTY_FILTERS,
  hasSearchCriteria,
  parseFilters,
  toggleDealsToday,
  toggleOpenNow,
} from "./filters.ts";

test("parseFilters reads deals_today=true and ignores anything else", () => {
  assert.equal(parseFilters({ deals_today: "true" }).dealsToday, true);
  assert.equal(parseFilters({ deals_today: ["true", "false"] }).dealsToday, true);
  assert.equal(parseFilters({ deals_today: "false" }).dealsToday, false);
  assert.equal(parseFilters({ deals_today: "1" }).dealsToday, false);
  assert.equal(parseFilters({}).dealsToday, false);
});

test("buildSearchHref round-trips the deals toggle alongside tag filters and page", () => {
  const filters = { ...EMPTY_FILTERS, cuisine: ["andhra"], dealsToday: true };
  const href = buildSearchHref({ filters, page: 2 });
  assert.equal(href, "/search?cuisine=andhra&deals_today=true&page=2");

  const parsed = parseFilters(Object.fromEntries(new URL(href, "http://x").searchParams));
  assert.deepEqual(parsed, filters);
});

test("buildSearchHref omits deals_today when the toggle is off", () => {
  assert.equal(buildSearchHref({ filters: EMPTY_FILTERS }), "/search");
});

test("toggleDealsToday flips the flag and countFilters counts it", () => {
  const on = toggleDealsToday(EMPTY_FILTERS);
  assert.equal(on.dealsToday, true);
  assert.equal(countFilters(on), 1);
  assert.equal(toggleDealsToday(on).dealsToday, false);
  assert.equal(countFilters(EMPTY_FILTERS), 0);
});

test("hasSearchCriteria is false for an empty search", () => {
  assert.equal(hasSearchCriteria({ filters: EMPTY_FILTERS }), false);
  assert.equal(hasSearchCriteria({ location: "", query: "", filters: EMPTY_FILTERS }), false);
  // Whitespace-only text is not a criterion.
  assert.equal(hasSearchCriteria({ location: "  ", query: "\t ", filters: EMPTY_FILTERS }), false);
});

test("hasSearchCriteria is true for each criterion type on its own", () => {
  assert.equal(hasSearchCriteria({ query: "indian", filters: EMPTY_FILTERS }), true);
  assert.equal(hasSearchCriteria({ location: "Plano", filters: EMPTY_FILTERS }), true);
  assert.equal(hasSearchCriteria({ filters: { ...EMPTY_FILTERS, cuisine: ["andhra"] } }), true);
  assert.equal(hasSearchCriteria({ filters: { ...EMPTY_FILTERS, dietary: ["vegan"] } }), true);
  assert.equal(hasSearchCriteria({ filters: { ...EMPTY_FILTERS, type: ["buffet"] } }), true);
  assert.equal(hasSearchCriteria({ filters: { ...EMPTY_FILTERS, dealsToday: true } }), true);
});

test("page and sort params alone are not criteria (via parseFilters on raw params)", () => {
  assert.equal(hasSearchCriteria({ filters: parseFilters({ page: "3", sort: "distance" }) }), false);
  // deals_today=false and invalid slugs don't count either.
  assert.equal(
    hasSearchCriteria({ filters: parseFilters({ deals_today: "false", cuisine: "Not A Slug!" }) }),
    false
  );
  // The top bar's link is a criterion.
  assert.equal(hasSearchCriteria({ filters: parseFilters({ deals_today: "true" }) }), true);
});

test("open_now round-trips, counts as a filter and as a search criterion", () => {
  assert.equal(parseFilters({ open_now: "true" }).openNow, true);
  assert.equal(parseFilters({ open_now: ["true", "x"] }).openNow, true);
  assert.equal(parseFilters({ open_now: "1" }).openNow, false);
  assert.equal(parseFilters({}).openNow, false);

  const on = toggleOpenNow(EMPTY_FILTERS);
  assert.equal(on.openNow, true);
  assert.equal(countFilters(on), 1);
  assert.equal(countFilters({ ...on, dealsToday: true }), 2);
  assert.equal(toggleOpenNow(on).openNow, false);
  assert.equal(hasSearchCriteria({ filters: on }), true);

  const href = buildSearchHref({ filters: { ...on, dealsToday: true }, location: "Plano", page: 2 });
  assert.equal(href, "/search?location=Plano&deals_today=true&open_now=true&page=2");
  assert.deepEqual(parseFilters(Object.fromEntries(new URL(href, "http://x").searchParams)), {
    ...on,
    dealsToday: true,
  });
  assert.equal(buildSearchHref({ filters: EMPTY_FILTERS }), "/search");
});
