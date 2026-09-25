// Unit tests for the restaurant page's deals-panel decision.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { dealsPanelMode } from "./panel.ts";

const deal = { id: 1, deal_type: "deal" as const, title: "BOGO", description: null };

test("signed-out visitor with a deal today gets the sign-in banner", () => {
  assert.equal(
    dealsPanelMode({ hasDealToday: true, dealsToday: null, signedIn: false }),
    "sign-in-banner",
  );
});

test("any signed-in viewer with content gets the full cards", () => {
  assert.equal(dealsPanelMode({ hasDealToday: true, dealsToday: [deal], signedIn: true }), "cards");
});

test("a signed-in viewer never gets the content-free pill or banner", () => {
  assert.equal(dealsPanelMode({ hasDealToday: true, dealsToday: null, signedIn: true }), "none");
  assert.equal(dealsPanelMode({ hasDealToday: true, dealsToday: [], signedIn: true }), "none");
  assert.equal(
    dealsPanelMode({ hasDealToday: true, dealsToday: undefined, signedIn: true }),
    "none",
  );
});

test("no deal today renders nothing for everyone", () => {
  assert.equal(dealsPanelMode({ hasDealToday: false, dealsToday: null, signedIn: false }), "none");
  assert.equal(dealsPanelMode({ hasDealToday: false, dealsToday: [], signedIn: true }), "none");
});
