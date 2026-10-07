// Unit tests for the shared timestamp formatter.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { formatInstant, parseInstant } from "./formatDateTime.ts";

// 2026-09-25T03:45:00Z == 10:45 PM the evening of Sep 24 in Chicago (CDT, UTC-5).
const INSTANT_Z = "2026-09-25T03:45:00Z";

test("'Z' input renders in the requested zone with an explicit zone label", () => {
  assert.equal(
    formatInstant(INSTANT_Z, { timeZone: "America/Chicago" }),
    "Sep 24, 2026, 10:45 PM CDT"
  );
  assert.equal(formatInstant(INSTANT_Z, { timeZone: "UTC" }), "Sep 25, 2026, 3:45 AM UTC");
});

test("defaults to UTC (deterministic on a server) and says so", () => {
  assert.equal(formatInstant(INSTANT_Z), "Sep 25, 2026, 3:45 AM UTC");
});

test("naive (offset-less) input is UTC, NOT the machine's local time", () => {
  const naive = "2026-09-25T03:45:00";
  assert.equal(parseInstant(naive)?.toISOString(), "2026-09-25T03:45:00.000Z");
  assert.equal(
    formatInstant(naive, { timeZone: "America/Chicago" }),
    "Sep 24, 2026, 10:45 PM CDT"
  );
  // Same for the space-separated form some serializers emit, and for
  // microsecond precision (Postgres/Python).
  assert.equal(parseInstant("2026-09-25 03:45:00")?.toISOString(), "2026-09-25T03:45:00.000Z");
  assert.equal(
    parseInstant("2026-09-25T03:45:00.123456")?.toISOString(),
    "2026-09-25T03:45:00.123Z"
  );
});

test("explicit offsets keep their true instant", () => {
  for (const withOffset of [
    "2026-09-24T22:45:00-05:00",
    "2026-09-24T22:45:00-0500",
    "2026-09-25T09:15:00+05:30",
    "2026-09-25T03:45:00+00:00",
  ]) {
    assert.equal(parseInstant(withOffset)?.toISOString(), "2026-09-25T03:45:00.000Z", withOffset);
    assert.equal(
      formatInstant(withOffset, { timeZone: "America/Chicago" }),
      "Sep 24, 2026, 10:45 PM CDT",
      withOffset
    );
  }
});

test("daylight saving: the label follows the date (CST in winter)", () => {
  assert.equal(
    formatInstant("2026-01-15T16:05:00Z", { timeZone: "America/Chicago" }),
    "Jan 15, 2026, 10:05 AM CST"
  );
});

test("date and shortDate variants use the calendar date in the given zone", () => {
  assert.equal(
    formatInstant(INSTANT_Z, { variant: "date", timeZone: "America/Chicago" }),
    "Sep 24, 2026"
  );
  assert.equal(formatInstant(INSTANT_Z, { variant: "date", timeZone: "UTC" }), "Sep 25, 2026");
  assert.equal(
    formatInstant(INSTANT_Z, { variant: "shortDate", timeZone: "America/Chicago" }),
    "Sep 24"
  );
});

test("date-only input is UTC midnight", () => {
  assert.equal(parseInstant("2026-09-24")?.toISOString(), "2026-09-24T00:00:00.000Z");
  assert.equal(formatInstant("2026-09-24", { variant: "date", timeZone: "UTC" }), "Sep 24, 2026");
});

test("missing / invalid input returns null (caller picks the fallback)", () => {
  assert.equal(formatInstant(null), null);
  assert.equal(formatInstant(undefined), null);
  assert.equal(formatInstant(""), null);
  assert.equal(formatInstant("   "), null);
  assert.equal(formatInstant("not a date"), null);
  assert.equal(parseInstant(new Date("nope")), null);
});

test("accepts a Date and an unknown zone name falls back to labelled UTC", () => {
  assert.equal(
    formatInstant(new Date("2026-09-25T03:45:00Z"), { timeZone: "America/Chicago" }),
    "Sep 24, 2026, 10:45 PM CDT"
  );
  assert.equal(
    formatInstant(INSTANT_Z, { timeZone: "Not/AZone" }),
    "Sep 25, 2026, 3:45 AM UTC"
  );
});
