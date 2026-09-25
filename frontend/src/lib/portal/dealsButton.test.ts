// Unit tests for the Deals button state helper. Run with Node's built-in runner:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { dealsButtonState } from "./dealsButton.ts";

test("live deals -> tinted 'Deals · N' with the count in the accessible name", () => {
  assert.deepEqual(dealsButtonState("Downtown", 2, false), {
    variant: "live",
    label: "Deals · 2",
    ariaLabel: "Deals for Downtown: 2 active",
  });
  assert.equal(dealsButtonState("Downtown", 1, false).label, "Deals · 1");
});

test("no live deals -> quiet 'Add a deal'", () => {
  const state = dealsButtonState("Downtown", 0, false);
  assert.equal(state.variant, "empty");
  assert.equal(state.label, "Add a deal");
  assert.match(state.ariaLabel, /^Add a deal for Downtown/);
});

test("Hide all deals ON -> grey 'Deals hidden', with the live count when there is one", () => {
  const none = dealsButtonState("Downtown", 0, true);
  assert.equal(none.variant, "hidden");
  assert.equal(none.label, "Deals hidden");
  const some = dealsButtonState("Downtown", 2, true);
  assert.equal(some.variant, "hidden");
  assert.equal(some.label, "Deals hidden · 2");
  assert.equal(some.ariaLabel, "Deals for Downtown: hidden from the public, 2 active");
});

test("hidden wins even when the count is unknown", () => {
  assert.equal(dealsButtonState("A", null, true).label, "Deals hidden");
});

test("unknown count (null/undefined, e.g. an older backend) -> neutral plain 'Deals'", () => {
  for (const c of [null, undefined]) {
    const state = dealsButtonState("Downtown", c, undefined);
    assert.equal(state.variant, "neutral");
    assert.equal(state.label, "Deals");
    assert.equal(state.ariaLabel, "Deals for Downtown");
  }
});

test("every state has distinct label text (colour is not the only signal)", () => {
  const labels = new Set([
    dealsButtonState("A", 3, false).label,
    dealsButtonState("A", 0, false).label,
    dealsButtonState("A", 3, true).label,
    dealsButtonState("A", null, null).label,
  ]);
  assert.equal(labels.size, 4);
});
