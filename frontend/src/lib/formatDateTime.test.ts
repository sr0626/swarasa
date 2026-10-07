import test from "node:test";
import assert from "node:assert/strict";
import { formatLocalDateTime, formatUtcDateTime } from "./formatDateTime.ts";

test("formatUtcDateTime is deterministic and labelled UTC", () => {
  assert.equal(formatUtcDateTime("2026-10-07T15:05:00Z"), "Oct 7, 2026, 3:05 PM UTC");
  assert.equal(formatUtcDateTime("2026-10-07T15:05:00+00:00"), "Oct 7, 2026, 3:05 PM UTC");
});

test("an invalid date falls back to the raw string rather than 'Invalid Date'", () => {
  assert.equal(formatUtcDateTime("not-a-date"), "not-a-date");
  assert.equal(formatLocalDateTime("not-a-date"), "not-a-date");
});

test("formatLocalDateTime renders a valid date", () => {
  assert.match(formatLocalDateTime("2026-10-07T15:05:00Z"), /2026/);
});
