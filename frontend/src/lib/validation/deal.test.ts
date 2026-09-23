// Unit tests for the deal form schema — mirrors backend/app/schemas/deal.py.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { dealFormSchema, updateDealFormSchema } from "./deal.ts";

const base = {
  deal_type: "deal",
  title: "  Lunch buffet  ",
  description: "",
  applicable_days: [],
  start_at: "",
  end_at: "",
  is_active: true,
};

test("empty day selection and blank dates become null (never an empty list)", () => {
  const parsed = dealFormSchema.parse(base);
  assert.equal(parsed.title, "Lunch buffet");
  assert.equal(parsed.description, null);
  assert.equal(parsed.applicable_days, null);
  assert.equal(parsed.start_at, null);
  assert.equal(parsed.end_at, null);
});

test("applicable_days is de-duplicated and sorted", () => {
  const parsed = dealFormSchema.parse({ ...base, applicable_days: [5, 1, 5, 0] });
  assert.deepEqual(parsed.applicable_days, [0, 1, 5]);
});

test("rejects a blank title, an out-of-range day and start >= end", () => {
  assert.equal(dealFormSchema.safeParse({ ...base, title: "   " }).success, false);
  assert.equal(dealFormSchema.safeParse({ ...base, applicable_days: [7] }).success, false);
  const reversed = dealFormSchema.safeParse({
    ...base,
    start_at: "2026-09-25T18:00",
    end_at: "2026-09-25T12:00",
  });
  assert.equal(reversed.success, false);
});

test("datetime-local values are converted to ISO instants", () => {
  const parsed = dealFormSchema.parse({ ...base, end_at: "2026-09-25T12:00" });
  assert.match(parsed.end_at ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("update schema accepts a bare is_active toggle without touching other fields", () => {
  const parsed = updateDealFormSchema.parse({ is_active: false });
  assert.deepEqual(parsed, { is_active: false });
});
