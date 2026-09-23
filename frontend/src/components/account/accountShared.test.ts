// Unit tests for the set-once display-name lock helper. Run with:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { NAME_LOCKED_NOTE, isNameLocked } from "./accountShared.ts";

test("isNameLocked is false while no name has been set", () => {
  assert.equal(isNameLocked(null), false);
  assert.equal(isNameLocked(undefined), false);
  assert.equal(isNameLocked(""), false);
  assert.equal(isNameLocked("   "), false);
});

test("isNameLocked is true once a non-empty name exists", () => {
  assert.equal(isNameLocked("Priya Rao"), true);
  assert.equal(isNameLocked("  Priya  "), true);
});

test("locked-name note points the user to an admin", () => {
  assert.match(NAME_LOCKED_NOTE, /admin/);
});
