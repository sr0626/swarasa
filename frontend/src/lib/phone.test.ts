// Unit tests for the shared US phone rule. The case table is IDENTICAL to
// tests/unit/test_phone_normalization.py (the backend twin) — keep both in
// sync. Run with Node's built-in runner:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { US_PHONE_ERROR, normalizePhone, phoneFieldError } from "./phone.ts";

const VALID: Array<[string, string]> = [
  ["(972) 555-0142", "+19725550142"],
  ["972-555-0142", "+19725550142"],
  ["972.555.0142", "+19725550142"],
  ["972 555 0142", "+19725550142"],
  ["9725550142", "+19725550142"],
  ["1 972 555 0142", "+19725550142"],
  ["1-972-555-0142", "+19725550142"],
  ["19725550142", "+19725550142"],
  ["1 (972) 555-0142", "+19725550142"],
  ["+19725550142", "+19725550142"],
  ["+1 (972) 555-0142", "+19725550142"],
  ["+1 972-555-0142", "+19725550142"],
  ["  (972) 555-0142  ", "+19725550142"],
];

const INVALID: string[] = [
  "",
  "   ",
  "12345",
  "not a phone",
  "555-0142", // missing area code
  "0725550142", // area code can't start with 0
  "1725550142", // area code can't start with 1
  "9720550142", // exchange can't start with 0
  "9721550142", // exchange can't start with 1
  "97255501420", // 11 digits not starting with the 1 country code (the reported bug)
  "29725550142", // 11 digits, country code 2
  "972555014", // 9 digits
  "+1555555", // too short after +1
  "+1 972 555 01421", // too long after +1
  "+29725550142", // "+" only means the +1 country code
  "+44 20 7946 0958", // non-US country code
  "+442079460958",
  "972-555-0142 ext 5", // extensions aren't part of the stored number
  "972-555-0142x5",
  "(972) 555-01ab",
  "972+5550142", // "+" anywhere but the front
  "++19725550142",
  "١٩٧٢٥٥٥٠١٤٢", // non-ASCII digits
];

test("normalizePhone accepts common US formats and stores +1XXXXXXXXXX", () => {
  for (const [input, expected] of VALID) {
    assert.equal(normalizePhone(input), expected, input);
  }
});

test("normalizePhone rejects everything that is not a 10-digit US number", () => {
  for (const input of INVALID) {
    assert.equal(normalizePhone(input), null, JSON.stringify(input));
  }
});

test("the inline error copy is the shared one", () => {
  assert.equal(US_PHONE_ERROR, "Enter a valid 10-digit US phone number");
});

test("phoneFieldError: required message for blank, shared message for bad, null for good", () => {
  assert.equal(phoneFieldError(""), "Phone number is required");
  assert.equal(phoneFieldError("   "), "Phone number is required");
  assert.equal(phoneFieldError("97255501420"), US_PHONE_ERROR);
  assert.equal(phoneFieldError("(972) 555-0142"), null);
  assert.equal(phoneFieldError("+19725550142"), null);
});
