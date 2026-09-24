// Unit tests for the deal form schema — mirrors backend/app/schemas/deal.py.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  dealFormSchema,
  END_REQUIRED_MESSAGE,
  START_REQUIRED_MESSAGE,
  updateDealFormSchema,
} from "./deal.ts";
import { fieldErrorsFromZod } from "./fieldErrors.ts";

const base = {
  deal_type: "deal",
  title: "  Lunch buffet  ",
  description: "",
  applicable_days: [],
  start_at: "2026-09-25T09:00",
  end_at: "2026-10-31T21:00",
  ongoing: false,
  is_active: true,
};

function errorsFor(input: unknown): Record<string, string> {
  const result = dealFormSchema.safeParse(input);
  assert.equal(result.success, false);
  return result.success ? {} : fieldErrorsFromZod(result.error);
}

test("empty day selection becomes null (never an empty list) and text is trimmed", () => {
  const parsed = dealFormSchema.parse(base);
  assert.equal(parsed.title, "Lunch buffet");
  assert.equal(parsed.description, null);
  assert.equal(parsed.applicable_days, null);
});

test("applicable_days is de-duplicated and sorted", () => {
  const parsed = dealFormSchema.parse({ ...base, applicable_days: [5, 1, 5, 0] });
  assert.deepEqual(parsed.applicable_days, [0, 1, 5]);
});

test("rejects a blank title and an out-of-range day", () => {
  assert.equal(dealFormSchema.safeParse({ ...base, title: "   " }).success, false);
  assert.equal(dealFormSchema.safeParse({ ...base, applicable_days: [7] }).success, false);
});

test("datetime-local values are converted to ISO instants", () => {
  const parsed = dealFormSchema.parse(base);
  assert.match(parsed.start_at ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.match(parsed.end_at ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("a missing start date is rejected with an inline message on start_at", () => {
  const errors = errorsFor({ ...base, start_at: "" });
  assert.equal(errors.start_at, START_REQUIRED_MESSAGE);
});

test("both dates blank -> both fields get a message (the original bug)", () => {
  const errors = errorsFor({ ...base, start_at: "", end_at: "" });
  assert.equal(errors.start_at, START_REQUIRED_MESSAGE);
  assert.equal(errors.end_at, END_REQUIRED_MESSAGE);
});

test("a missing end date is rejected unless Ongoing is ticked", () => {
  const errors = errorsFor({ ...base, end_at: "" });
  assert.equal(errors.end_at, END_REQUIRED_MESSAGE);
  assert.equal(errors.start_at, undefined);
});

test("Ongoing with no end date is accepted and sends end_at null", () => {
  const parsed = dealFormSchema.parse({ ...base, end_at: "", ongoing: true });
  assert.equal(parsed.end_at, null);
  assert.equal(parsed.ongoing, true);
  assert.ok(parsed.start_at);
});

test("Ongoing discards a stale end date rather than sending both", () => {
  const parsed = dealFormSchema.parse({ ...base, ongoing: true });
  assert.equal(parsed.end_at, null);
});

test("end before start (and end equal to start) is rejected on end_at", () => {
  const reversed = errorsFor({ ...base, start_at: "2026-09-25T18:00", end_at: "2026-09-25T12:00" });
  assert.match(reversed.end_at, /after the start/);
  const equal = errorsFor({ ...base, start_at: "2026-09-25T18:00", end_at: "2026-09-25T18:00" });
  assert.match(equal.end_at, /after the start/);
});

test("update schema accepts a bare is_active toggle without touching other fields", () => {
  const parsed = updateDealFormSchema.parse({ is_active: false });
  assert.deepEqual(parsed, { is_active: false });
});

test("update schema: a legacy deal can be retitled without sending dates", () => {
  const parsed = updateDealFormSchema.parse({ title: "Renamed" });
  assert.deepEqual(parsed, { title: "Renamed" });
});

test("update schema: sending an empty start or an empty end without Ongoing is rejected", () => {
  assert.equal(updateDealFormSchema.safeParse({ start_at: "" }).success, false);
  assert.equal(updateDealFormSchema.safeParse({ end_at: "" }).success, false);
  const ok = updateDealFormSchema.parse({ end_at: "", ongoing: true });
  assert.equal(ok.end_at, null);
});

test("update schema: the full form payload follows the create rules", () => {
  assert.equal(updateDealFormSchema.safeParse({ ...base, start_at: "" }).success, false);
  assert.equal(updateDealFormSchema.safeParse(base).success, true);
});
