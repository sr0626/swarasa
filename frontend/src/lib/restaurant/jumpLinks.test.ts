// Unit tests for the location page's jump links (Deals · Menu · Hours).
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { buildJumpLinks, hasDealsSection, hasKnownHours } from "./jumpLinks.ts";

test("all three sections present -> Deals, Menu, Hours in that order with # anchors", () => {
  assert.deepEqual(buildJumpLinks({ deals: true, menu: true, hours: true }), [
    { id: "deals", label: "Deals", href: "#deals" },
    { id: "menu", label: "Menu", href: "#menu" },
    { id: "hours", label: "Hours", href: "#hours" },
  ]);
});

test("only the sections that exist are linked", () => {
  assert.deepEqual(
    buildJumpLinks({ deals: false, menu: true, hours: true }).map((l) => l.id),
    ["menu", "hours"]
  );
  assert.deepEqual(buildJumpLinks({ deals: false, menu: false, hours: false }), []);
});

test("a single section is not worth a jump row (no lone 'Hours' pill)", () => {
  assert.deepEqual(buildJumpLinks({ deals: false, menu: false, hours: true }), []);
  assert.deepEqual(buildJumpLinks({ deals: true, menu: false, hours: false }), []);
  assert.deepEqual(buildJumpLinks({ deals: false, menu: true, hours: false }), []);
  assert.equal(buildJumpLinks({ deals: true, menu: false, hours: true }).length, 2);
});

test("hasDealsSection: today's deal or content-visible upcoming deals", () => {
  assert.equal(hasDealsSection({ has_deal_today: true, upcoming_deals: null }), true);
  assert.equal(hasDealsSection({ has_deal_today: false, upcoming_deals: [{}] }), true);
  assert.equal(hasDealsSection({ has_deal_today: false, upcoming_deals: [] }), false);
  // Signed-out viewers get null upcoming deals (content-gated): no link to a section that is not there.
  assert.equal(hasDealsSection({ has_deal_today: false, upcoming_deals: null }), false);
  assert.equal(hasDealsSection({ has_deal_today: false }), false);
});

test("hasKnownHours matches the Hours block's own rule (unknown days are not hours)", () => {
  assert.equal(hasKnownHours([]), false);
  assert.equal(hasKnownHours([{ is_closed: null }, { is_closed: null }]), false);
  assert.equal(hasKnownHours([{ is_closed: null }, { is_closed: true }]), true);
  assert.equal(hasKnownHours([{ is_closed: false }]), true);
});
