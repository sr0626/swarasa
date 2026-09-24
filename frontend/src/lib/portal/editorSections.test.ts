// Unit tests for the location-editor section list and status-menu rules.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { editorSectionsForRole } from "./editorSections.ts";
import { statusMenuActions } from "./locationStatusActions.ts";

test("owner sees every section, Deals then Hours first, Managers last", () => {
  const ids = editorSectionsForRole("owner").map((s) => s.id);
  assert.deepEqual(ids, ["deals", "hours", "menu", "photos", "about", "info", "managers"]);
});

test("admin and manager do not get the owner-only Managers link", () => {
  for (const role of ["admin", "manager"]) {
    const ids = editorSectionsForRole(role).map((s) => s.id);
    assert.deepEqual(ids, ["deals", "hours", "menu", "photos", "about", "info"]);
  }
});

test("deals and menu keep the anchor ids the redirect pages use", () => {
  const byId = Object.fromEntries(editorSectionsForRole("owner").map((s) => [s.id, s.anchorId]));
  assert.equal(byId.deals, "deals");
  assert.equal(byId.menu, "menu");
});

test("anchor ids are unique", () => {
  const anchors = editorSectionsForRole("owner").map((s) => s.anchorId);
  assert.equal(new Set(anchors).size, anchors.length);
});

test("manager gets a non-interactive status label", () => {
  const a = statusMenuActions("active", "manager");
  assert.equal(a.interactive, false);
  assert.equal(a.setStatus || a.markClosed || a.requestReopen || a.remove, false);
});

test("owner on an active location: switch/close, no remove", () => {
  assert.deepEqual(statusMenuActions("active", "owner"), {
    interactive: true, setStatus: true, markClosed: true, requestReopen: false, remove: false,
  });
});

test("hidden and coming-soon locations can also be permanently removed", () => {
  for (const s of ["owner_deactivated", "coming_soon"] as const) {
    const a = statusMenuActions(s, "admin");
    assert.equal(a.setStatus, true);
    assert.equal(a.markClosed, true);
    assert.equal(a.remove, true);
    assert.equal(a.requestReopen, false);
  }
});

test("closed_pending_reopen: no self-service change; owner can request reopen, admin cannot", () => {
  assert.deepEqual(statusMenuActions("closed_pending_reopen", "owner"), {
    interactive: true, setStatus: false, markClosed: false, requestReopen: true, remove: true,
  });
  assert.deepEqual(statusMenuActions("closed_pending_reopen", "admin"), {
    interactive: true, setStatus: false, markClosed: false, requestReopen: false, remove: true,
  });
});
