// Unit tests for the admin Listings missing-info chips.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { READY_LABEL, isSetupStatus, setupChipsSummary, setupChipsView } from "./adminListingSetup.ts";

test("only coming_soon and import_review rows show chips", () => {
  assert.equal(isSetupStatus("coming_soon"), true);
  assert.equal(isSetupStatus("import_review"), true);
  for (const status of ["active", "owner_deactivated", "closed_pending_reopen"]) {
    assert.equal(isSetupStatus(status), false, status);
    assert.equal(setupChipsView(status, ["hours"]), null, status);
  }
});

test("missing keys become labelled chips in checklist order", () => {
  const view = setupChipsView("import_review", ["hours", "name", "phone", "address"]);
  assert.ok(view);
  assert.equal(view.ready, false);
  assert.equal(view.readyLabel, null);
  assert.deepEqual(
    view.chips.map((c) => c.label),
    ["Missing name", "Missing address", "Missing phone", "Missing hours"]
  );
});

test("nothing missing = 'Ready to activate' with no chips", () => {
  for (const status of ["import_review", "coming_soon"]) {
    const view = setupChipsView(status, []);
    assert.ok(view);
    assert.equal(view.ready, true);
    assert.equal(view.readyLabel, READY_LABEL);
    assert.deepEqual(view.chips, []);
  }
  // A server that omits the field is treated as nothing missing, not a crash.
  assert.equal(setupChipsView("coming_soon", undefined)?.ready, true);
});

test("an unknown key still gets a chip so a gap is never dropped", () => {
  const view = setupChipsView("import_review", ["hours", "photo_required"]);
  assert.ok(view);
  assert.deepEqual(
    view.chips.map((c) => c.label),
    ["Missing hours", "Missing: photo required"]
  );
});

test("summary text carries the meaning for screen readers", () => {
  const missing = setupChipsView("import_review", ["phone", "hours"]);
  const ready = setupChipsView("import_review", []);
  assert.ok(missing && ready);
  assert.equal(setupChipsSummary(missing), "Missing phone, Missing hours");
  assert.equal(setupChipsSummary(ready), "Ready to activate");
});
