// Unit tests for the retired-tag helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { retiredTags, withRetiredOptions } from "./retired.ts";
import type { CuisineTag } from "../../types/cuisine.ts";

const t = (id: number, name: string): CuisineTag => ({
  id,
  name,
  display_name: name.toUpperCase(),
  category: "type",
});

test("retiredTags returns current tags missing from the active taxonomy", () => {
  const active = [t(1, "a"), t(2, "b")];
  const current = [t(2, "b"), t(9, "gone")];
  assert.deepEqual(
    retiredTags(active, current).map((x) => x.id),
    [9]
  );
  assert.deepEqual(retiredTags(active, []), []);
});

test("withRetiredOptions appends labelled retired chips without mutating inputs", () => {
  const active = [t(1, "a")];
  const retired = [t(9, "gone")];
  const options = withRetiredOptions(active, retired);
  assert.deepEqual(
    options.map((x) => x.display_name),
    ["A", "GONE (retired)"]
  );
  assert.equal(retired[0].display_name, "GONE");
});
