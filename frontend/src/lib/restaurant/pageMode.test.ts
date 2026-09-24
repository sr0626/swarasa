// Unit tests for the single-vs-landing decision behind /restaurant/{brandSlug}.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { decideBrandPage, sortLocationsForLanding } from "./pageMode.ts";

const loc = (location_id: number, city: string) => ({ location_id, city });

test("no active locations -> brand-only page", () => {
  assert.deepEqual(decideBrandPage([]), { kind: "none" });
});

test("exactly one active location -> that location's profile at the brand URL", () => {
  const only = loc(7, "Irving");
  assert.deepEqual(decideBrandPage([only]), { kind: "single", location: only });
});

test("two or more active locations -> landing page, sorted by city then id", () => {
  const result = decideBrandPage([loc(3, "Plano"), loc(2, "irving"), loc(1, "Irving")]);
  assert.equal(result.kind, "landing");
  assert.deepEqual(
    result.kind === "landing" ? result.locations.map((l) => l.location_id) : [],
    [1, 2, 3]
  );
});

test("sort is stable across input order and does not mutate the input", () => {
  const input = [loc(5, "Dallas"), loc(4, "Dallas"), loc(9, "Allen")];
  const before = [...input];
  assert.deepEqual(
    sortLocationsForLanding(input).map((l) => l.location_id),
    [9, 4, 5]
  );
  assert.deepEqual(input, before);
});

test("a second location added later turns a single page into the landing page", () => {
  const one = [loc(1, "Irving")];
  assert.equal(decideBrandPage(one).kind, "single");
  assert.equal(decideBrandPage([...one, loc(2, "Plano")]).kind, "landing");
});
