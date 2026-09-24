// Unit tests for the report-a-problem schema + category labels — mirrors
// POST /reports in docs/API_CONTRACTS.md.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_CATEGORIES, reportCategoryLabel } from "../constants/reportCategories.ts";
import { createReportSchema, reportCategorySchema } from "./listingReport.ts";

const base = { brand_id: 1, category: "other", details: "Something is off." };

test("deal_incorrect is an accepted category with a label", () => {
  assert.equal(reportCategorySchema.safeParse("deal_incorrect").success, true);
  assert.equal(reportCategoryLabel("deal_incorrect"), "Deal is wrong or outdated");
  assert.ok(REPORT_CATEGORIES.some((c) => c.value === "deal_incorrect"));
});

test("every radio option is a valid schema category", () => {
  for (const option of REPORT_CATEGORIES) {
    assert.equal(reportCategorySchema.safeParse(option.value).success, true, option.value);
  }
});

test("unknown category is rejected", () => {
  assert.equal(createReportSchema.safeParse({ ...base, category: "nope" }).success, false);
});

test("email stays optional: blank ok, malformed rejected", () => {
  assert.equal(createReportSchema.safeParse({ ...base, reporter_email: "" }).success, true);
  assert.equal(createReportSchema.safeParse({ ...base, reporter_email: null }).success, true);
  assert.equal(createReportSchema.safeParse({ ...base }).success, true);
  assert.equal(createReportSchema.safeParse({ ...base, reporter_email: "bad" }).success, false);
});
