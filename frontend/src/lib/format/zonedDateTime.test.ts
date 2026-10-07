// Run with Node's built-in runner:   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { formatZonedDateTime } from "./zonedDateTime.ts";

test("formats in the given timezone with its label (CDT in September)", () => {
  assert.equal(
    formatZonedDateTime("2026-09-25T03:45:00Z", "America/Chicago"),
    "Sep 24, 2026, 10:45 PM CDT",
  );
});

test("uses standard-time label in winter", () => {
  assert.equal(
    formatZonedDateTime("2026-01-15T18:00:00Z", "America/Chicago"),
    "Jan 15, 2026, 12:00 PM CST",
  );
});

test("a different timezone changes the wall time and label", () => {
  assert.equal(
    formatZonedDateTime("2026-09-25T03:45:00Z", "America/Los_Angeles"),
    "Sep 24, 2026, 8:45 PM PDT",
  );
});

test("bad or missing timezone falls back to America/Chicago", () => {
  const expected = "Sep 24, 2026, 10:45 PM CDT";
  assert.equal(formatZonedDateTime("2026-09-25T03:45:00Z", "Not/AZone"), expected);
  assert.equal(formatZonedDateTime("2026-09-25T03:45:00Z", null), expected);
  assert.equal(formatZonedDateTime("2026-09-25T03:45:00Z", undefined), expected);
});

test("an unparseable date is returned unchanged", () => {
  assert.equal(formatZonedDateTime("not a date", "America/Chicago"), "not a date");
});
