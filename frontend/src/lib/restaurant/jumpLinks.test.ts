// Unit tests for the location page's jump links (Menu · Hours).
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { buildJumpLinks, hasKnownHours } from "./jumpLinks.ts";

test("menu and hours present -> Menu, Hours in that order with # anchors", () => {
  assert.deepEqual(buildJumpLinks({ menu: true, hours: true }), [
    { id: "menu", label: "Menu", href: "#menu" },
    { id: "hours", label: "Hours", href: "#hours" },
  ]);
});

test("a single section is not worth a jump row (no lone pill); Deals is never a jump target", () => {
  assert.deepEqual(buildJumpLinks({ menu: false, hours: true }), []);
  assert.deepEqual(buildJumpLinks({ menu: true, hours: false }), []);
  assert.deepEqual(buildJumpLinks({ menu: false, hours: false }), []);
  assert.ok(!buildJumpLinks({ menu: true, hours: true }).some((l) => (l.id as string) === "deals"));
});

test("hasKnownHours matches the Hours block's own rule (unknown days are not hours)", () => {
  assert.equal(hasKnownHours([]), false);
  assert.equal(hasKnownHours([{ is_closed: null }, { is_closed: null }]), false);
  assert.equal(hasKnownHours([{ is_closed: null }, { is_closed: true }]), true);
  assert.equal(hasKnownHours([{ is_closed: false }]), true);
});
