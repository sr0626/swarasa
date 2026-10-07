// Run with Node's built-in runner:   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { addressChanged, describeMapPosition, needsRegeocode } from "./locationCoordinates.ts";

const base = { address_line1: "500 Legacy Dr", city: "Plano", state: "TX", postal_code: "75024" };

test("addressChanged ignores whitespace and state case", () => {
  assert.equal(addressChanged({ ...base, state: "tx", city: " Plano " }, base), false);
});

test("addressChanged detects each geocodable field", () => {
  assert.equal(addressChanged({ ...base, address_line1: "501 Legacy Dr" }, base), true);
  assert.equal(addressChanged({ ...base, city: "Frisco" }, base), true);
  assert.equal(addressChanged({ ...base, state: "OK" }, base), true);
  assert.equal(addressChanged({ ...base, postal_code: "75034" }, base), true);
});

test("needsRegeocode: address change, or no stored position yet", () => {
  assert.equal(needsRegeocode(base, base, true), false);
  assert.equal(needsRegeocode({ ...base, city: "Frisco" }, base, true), true);
  assert.equal(needsRegeocode(base, base, false), true);
});

test("describeMapPosition formats a stored position", () => {
  assert.equal(
    describeMapPosition(32.851234, -96.974321),
    "Map position: 32.85, -96.97 — updated automatically from the address."
  );
});

test("describeMapPosition explains a missing position", () => {
  for (const [lat, lng] of [
    [null, null],
    [undefined, undefined],
    [32.8, null],
    [Number.NaN, -96.9],
  ] as const) {
    assert.match(describeMapPosition(lat, lng), /not set yet/);
  }
});
