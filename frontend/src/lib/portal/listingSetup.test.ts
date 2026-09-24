// Unit tests for the listing-setup checklist rules. Run with Node's built-in runner:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  activationBlockedReason,
  canActivate,
  finishSetupLabel,
  goLiveBarState,
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

test("finishSetupLabel: count when known, 'go live' when nothing is left", () => {
  assert.equal(finishSetupLabel(null), "Finish setup");
  assert.equal(finishSetupLabel(["hours", "phone"]), "Finish setup · 2 left");
  assert.equal(finishSetupLabel([]), "Finish setup & go live");
});

test("goLiveBarState: no bar outside setup", () => {
  for (const status of ["active", "owner_deactivated", "closed_pending_reopen"] as const) {
    assert.equal(goLiveBarState(status, ["hours"]), null, status);
    assert.equal(goLiveBarState(status, []), null, status);
  }
});

test("goLiveBarState: counts what is left, in checklist order", () => {
  const one = goLiveBarState("coming_soon", ["hours"]);
  assert.equal(one?.kind, "missing");
  assert.equal(one?.headline, "1 thing left: add hours");
  assert.equal(one?.reason, "To go live: add your opening hours.");
  assert.deepEqual(one?.items.map((item) => item.key), ["hours"]);
  assert.equal(one?.hasUnknown, false);
  assert.equal(one?.count, 1);
  const two = goLiveBarState("coming_soon", ["hours", "phone"]);
  assert.equal(two?.kind, "missing");
  assert.equal(two?.headline, "2 things left: add phone, add hours");
  assert.deepEqual(two?.items.map((item) => item.sectionId), ["info", "hours"]);
});

test("goLiveBarState: ready once nothing is missing", () => {
  assert.deepEqual(goLiveBarState("coming_soon", []), {
    kind: "ready",
    headline: "All set — ready to go live",
    reason: null,
    count: 0,
    items: [],
    hasUnknown: false,
  });
});

test("goLiveBarState: an unknown key from a newer server keeps the bar in 'missing'", () => {
  const state = goLiveBarState("coming_soon", ["something_new"]);
  assert.equal(state?.kind, "missing");
  assert.equal(state?.headline, "1 thing left: finish the remaining details");
  assert.equal(state?.reason, "Finish setting up this listing first.");
  assert.equal(state?.hasUnknown, true);
  assert.deepEqual(state?.items, []);
  const mixed = goLiveBarState("coming_soon", ["hours", "something_new"]);
  assert.equal(mixed?.headline, "2 things left: add hours, finish the remaining details");
});
