// Unit tests for the sitemap's canonical-path selection.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPathsForRow, canonicalPathsForRows } from "./sitemapPaths.ts";
import { brandHref, locationHref } from "./urls.ts";

const row = (brand_slug: string, location_slug: string, active_location_count: number) => ({
  brand_slug,
  location_slug,
  active_location_count,
});

test("a single-location brand lists only the short brand URL", () => {
  assert.deepEqual(canonicalPathsForRows([row("solo-grill", "irving", 1)]), [
    "/restaurant/solo-grill",
  ]);
});

test("a multi-location brand lists the landing page once plus every location page", () => {
  assert.deepEqual(
    canonicalPathsForRows([row("chain", "irving", 2), row("chain", "plano", 2)]),
    ["/restaurant/chain", "/restaurant/chain/irving", "/restaurant/chain/plano"]
  );
});

test("every active location of every brand is covered, no duplicates", () => {
  const paths = canonicalPathsForRows([
    row("solo-grill", "irving", 1),
    row("chain", "irving", 3),
    row("chain", "plano", 3),
    row("chain", "allen", 3),
  ]);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(paths, [
    "/restaurant/solo-grill",
    "/restaurant/chain",
    "/restaurant/chain/irving",
    "/restaurant/chain/plano",
    "/restaurant/chain/allen",
  ]);
});

test("path shapes match the shared URL helpers (no drift)", () => {
  assert.deepEqual(canonicalPathsForRow(row("chain", "irving", 2)), [
    brandHref("chain"),
    locationHref("chain", "irving"),
  ]);
  assert.deepEqual(canonicalPathsForRow(row("solo", "irving", 1)), [brandHref("solo")]);
});
