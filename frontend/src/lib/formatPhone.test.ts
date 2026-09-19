// Unit tests for the phone display helper. Run with Node's built-in runner:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { formatPhone } from "./formatPhone.ts";

test("formatPhone formats E.164 US numbers", () => {
  assert.equal(formatPhone("+19725550142"), "(972) 555-0142");
  assert.equal(formatPhone("+12145551234"), "(214) 555-1234");
  assert.equal(formatPhone(" +19725550142 "), "(972) 555-0142");
});

test("formatPhone leaves unrecognised strings unchanged", () => {
  const cases = [
    "+442071838750", // UK
    "+919876543210", // India
    "9725550142", // legacy, no +1
    "(972) 555-0142", // already formatted
    "+1972555014", // too short
    "+197255501423", // too long
    "call us",
    "",
  ];
  for (const input of cases) assert.equal(formatPhone(input), input);
});
