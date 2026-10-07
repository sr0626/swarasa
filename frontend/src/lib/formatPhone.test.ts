// Unit tests for the phone display helper. Run with Node's built-in runner:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { formatPhone, phoneHref } from "./formatPhone.ts";

test("formatPhone formats E.164 US numbers", () => {
  assert.equal(formatPhone("+19725550142"), "(972) 555-0142");
  assert.equal(formatPhone("+12145551234"), "(214) 555-1234");
  assert.equal(formatPhone(" +19725550142 "), "(972) 555-0142");
});

test("formatPhone formats legacy bare 10-digit and 11-digit numbers", () => {
  assert.equal(formatPhone("4691231234"), "(469) 123-1234");
  assert.equal(formatPhone("9725550142"), "(972) 555-0142");
  assert.equal(formatPhone("19725550142"), "(972) 555-0142");
  assert.equal(formatPhone(" 4691231234 "), "(469) 123-1234");
});

test("formatPhone normalises other US shapes to the one display format", () => {
  assert.equal(formatPhone("972-555-0142"), "(972) 555-0142");
  assert.equal(formatPhone("972.555.0142"), "(972) 555-0142");
  assert.equal(formatPhone("1 (972) 555-0142"), "(972) 555-0142");
  assert.equal(formatPhone("(972) 555-0142"), "(972) 555-0142");
});

test("formatPhone leaves unrecognised strings unchanged", () => {
  const cases = [
    "+442071838750", // UK
    "+919876543210", // India
    "+1972555014", // too short
    "+197255501423", // too long
    "+9725550142", // "+" without the 1 country code
    "97255501", // 8 digits
    "29725550142", // 11 digits not starting with 1
    "972-555-0142 ext 4", // extension
    "9725550142+", // stray plus
    "call us",
    "",
  ];
  for (const input of cases) assert.equal(formatPhone(input), input);
});

test("phoneHref returns clean E.164 for any recognisable US number", () => {
  assert.equal(phoneHref("+19725550142"), "+19725550142");
  assert.equal(phoneHref("4691231234"), "+14691231234");
  assert.equal(phoneHref("14691231234"), "+14691231234");
  assert.equal(phoneHref("(972) 555-0142"), "+19725550142");
});

test("phoneHref passes unrecognised values through trimmed", () => {
  assert.equal(phoneHref(" +442071838750 "), "+442071838750");
  assert.equal(phoneHref("call us"), "call us");
});
