// Unit tests for the manual-subscription helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { datePart, describeSubscription, MANUAL_LABEL, validateUntilDate } from "./subscription.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");

test("manual label says no payment is taken", () => {
  assert.match(MANUAL_LABEL, /MANUAL/);
  assert.match(MANUAL_LABEL, /no payment taken/);
});

test("describeSubscription follows the server rule", () => {
  assert.deepEqual(describeSubscription(false, null, NOW), { subscribed: false, text: "Not subscribed" });
  assert.deepEqual(describeSubscription(false, "2027-01-31T23:59:59Z", NOW), {
    subscribed: false,
    text: "Not subscribed",
  });
  assert.deepEqual(describeSubscription(true, null, NOW), {
    subscribed: true,
    text: "Subscribed (no end date)",
  });
  assert.deepEqual(describeSubscription(true, "2027-01-31T23:59:59Z", NOW), {
    subscribed: true,
    text: "Subscribed until 2027-01-31",
  });
  assert.deepEqual(describeSubscription(true, "2026-11-01T23:59:59Z", NOW), {
    subscribed: false,
    text: "Subscription ended 2026-11-01",
  });
});

test("datePart keeps the calendar date", () => {
  assert.equal(datePart("2027-01-31T23:59:59+00:00"), "2027-01-31");
});

test("datePart: end of day at a US location is still the chosen date", () => {
  // Eastern, Central (winter and summer), Pacific, Hawaii.
  assert.equal(datePart("2027-02-01T04:59:59Z"), "2027-01-31");
  assert.equal(datePart("2027-01-01T05:59:59Z"), "2026-12-31");
  assert.equal(datePart("2027-07-01T04:59:59Z"), "2027-06-30");
  assert.equal(datePart("2027-02-01T07:59:59Z"), "2027-01-31");
  assert.equal(datePart("2027-02-01T09:59:59Z"), "2027-01-31");
});

test("validateUntilDate: empty ok, future ok, today/past/garbage rejected", () => {
  const today = "2026-11-13";
  assert.equal(validateUntilDate("", today), null);
  assert.equal(validateUntilDate("2026-11-14", today), null);
  assert.ok(validateUntilDate("2026-11-13", today));
  assert.ok(validateUntilDate("2026-01-01", today));
  assert.ok(validateUntilDate("tomorrow", today));
  assert.ok(validateUntilDate("2027-02-30", today));
});
