// Unit tests for the listing-setup checklist rules. Run with Node's built-in runner:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  activationBlockedReason,
  canActivate,
  isInSetup,
  knownMissing,
  setupChecklist,
  setupSummary,
} from "./listingSetup.ts";

test("only a coming_soon listing is 'in setup'", () => {
  assert.equal(isInSetup("coming_soon"), true);
  for (const status of ["active", "owner_deactivated", "closed_pending_reopen"] as const) {
    assert.equal(isInSetup(status), false, status);
  }
});

test("setupSummary reads like 'To go live: …' in checklist order", () => {
  assert.equal(setupSummary([]), null);
  assert.equal(setupSummary(["hours"]), "To go live: add your opening hours.");
  assert.equal(
    setupSummary(["hours", "phone"]),
    "To go live: add a valid US phone number, add your opening hours."
  );
});

test("canActivate needs a setup listing with nothing missing", () => {
  assert.equal(canActivate("coming_soon", []), true);
  assert.equal(canActivate("coming_soon", ["hours"]), false);
  assert.equal(canActivate("coming_soon", ["phone", "hours"]), false);
  assert.equal(canActivate("active", []), false, "already live");
  assert.equal(canActivate("owner_deactivated", []), false, "hidden listings use the status menu");
  // A key from a newer server still blocks; the server is authoritative.
  assert.equal(canActivate("coming_soon", ["something_new"]), false);
});

test("activationBlockedReason explains the disabled 'Active' choice", () => {
  assert.equal(activationBlockedReason("coming_soon", []), null);
  assert.equal(
    activationBlockedReason("coming_soon", ["hours"]),
    "To go live: add your opening hours."
  );
  // Not in setup: un-hiding a previously live listing isn't gated.
  assert.equal(activationBlockedReason("owner_deactivated", ["hours"]), null);
  assert.equal(activationBlockedReason("active", ["hours"]), null);
  // Unknown key only: still blocked, with the generic sentence.
  assert.equal(
    activationBlockedReason("coming_soon", ["something_new"]),
    "Finish setting up this listing first."
  );
});

test("knownMissing drops keys this UI has no row for, keeping order", () => {
  assert.deepEqual(knownMissing(["hours", "wat", "phone"]), ["phone", "hours"]);
});

test("setupChecklist flags each row done or missing", () => {
  const rows = setupChecklist(["hours"]);
  assert.deepEqual(
    rows.map((row) => [row.key, row.done]),
    [
      ["name", true],
      ["address", true],
      ["phone", true],
      ["hours", false],
    ]
  );
  assert.equal(rows.find((row) => row.key === "hours")?.sectionId, "hours");
});
