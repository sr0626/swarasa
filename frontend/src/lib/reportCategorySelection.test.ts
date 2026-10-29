// Unit tests for the multi-select report category logic.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_CATEGORIES } from "./constants/reportCategories.ts";
import {
  CANONICAL_ORDER,
  REPORT_CATEGORY_REQUIRED_MESSAGE,
  orderCategories,
  toggleCategory,
  validateCategorySelection,
} from "./reportCategorySelection.ts";

test("toggling adds then removes a category", () => {
  const one = toggleCategory([], "hours_incorrect");
  assert.deepEqual(one, ["hours_incorrect"]);
  assert.deepEqual(toggleCategory(one, "hours_incorrect"), []);
});

test("selection stays in canonical option order regardless of click order", () => {
  let selected = toggleCategory([], "other");
  selected = toggleCategory(selected, "permanently_closed");
  selected = toggleCategory(selected, "address_incorrect");
  assert.deepEqual(selected, ["address_incorrect", "permanently_closed", "other"]);
});

test("toggle does not mutate its input", () => {
  const input = Object.freeze(["hours_incorrect"] as const);
  const next = toggleCategory(input, "other");
  assert.deepEqual(input, ["hours_incorrect"]);
  assert.deepEqual(next, ["hours_incorrect", "other"]);
});

test("orderCategories de-duplicates and drops unknown values", () => {
  const messy = ["other", "hours_incorrect", "other", "bogus"] as never;
  assert.deepEqual(orderCategories(messy), ["hours_incorrect", "other"]);
});

test("all options can be selected at once", () => {
  let selected: ReturnType<typeof orderCategories> = [];
  for (const option of [...REPORT_CATEGORIES].reverse()) {
    selected = toggleCategory(selected, option.value);
  }
  assert.deepEqual(
    selected,
    REPORT_CATEGORIES.map((c) => c.value)
  );
});

test("at least one category is required", () => {
  assert.equal(validateCategorySelection([]), REPORT_CATEGORY_REQUIRED_MESSAGE);
  assert.equal(validateCategorySelection(["other"]), null);
  assert.equal(validateCategorySelection(["menu_incorrect", "other"]), null);
});

test("canonical order matches the option list the form renders", () => {
  assert.deepEqual(
    [...CANONICAL_ORDER],
    REPORT_CATEGORIES.map((c) => c.value)
  );
});
