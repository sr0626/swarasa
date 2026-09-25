// Unit tests for the per-location cuisine tag helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  CUISINE_CATEGORY_ORDER,
  groupTagsByCategory,
  orderedCategories,
  sameTagIds,
  summarizeTags,
  toggleTagId,
} from "./tags.ts";

const tag = (name: string, category: "regional" | "dietary" | "type" | "signature" | "dining_time") => ({
  name,
  category,
});

test("groups by category, keeping input order inside a group", () => {
  const groups = groupTagsByCategory([
    tag("andhra", "regional"),
    tag("nut_free", "dietary"),
    tag("mughlai", "regional"),
  ]);
  assert.deepEqual(groups.get("regional")?.map((t) => t.name), ["andhra", "mughlai"]);
  assert.deepEqual(groups.get("dietary")?.map((t) => t.name), ["nut_free"]);
  assert.equal(groups.has("type"), false);
});

test("orderedCategories lists only categories that have tags, in display order", () => {
  const groups = groupTagsByCategory([
    tag("breakfast_menu", "dining_time"),
    tag("nut_free", "dietary"),
    tag("andhra", "regional"),
  ]);
  assert.deepEqual(orderedCategories(groups), ["regional", "dietary", "dining_time"]);
  assert.equal(CUISINE_CATEGORY_ORDER.length, 5);
});

test("summarizeTags shows the first N and counts the rest", () => {
  const tags = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(summarizeTags(tags, 4), { shown: ["a", "b", "c", "d"], hiddenCount: 2 });
  assert.deepEqual(summarizeTags(tags.slice(0, 3), 4), { shown: ["a", "b", "c"], hiddenCount: 0 });
  assert.deepEqual(summarizeTags([], 4), { shown: [], hiddenCount: 0 });
});

test("summarizeTags exactly at the cap shows no +N, and clamps a silly max", () => {
  assert.deepEqual(summarizeTags(["a", "b", "c", "d"], 4).hiddenCount, 0);
  assert.deepEqual(summarizeTags(["a", "b"], 0), { shown: ["a"], hiddenCount: 1 });
});

test("toggleTagId adds then removes, without mutating", () => {
  const start = [1, 2];
  assert.deepEqual(toggleTagId(start, 3), [1, 2, 3]);
  assert.deepEqual(toggleTagId(start, 1), [2]);
  assert.deepEqual(start, [1, 2]);
});

test("sameTagIds ignores order but not membership", () => {
  assert.equal(sameTagIds([1, 2, 3], [3, 1, 2]), true);
  assert.equal(sameTagIds([1, 2], [1, 2, 3]), false);
  assert.equal(sameTagIds([1, 2], [1, 4]), false);
  assert.equal(sameTagIds([], []), true);
});
