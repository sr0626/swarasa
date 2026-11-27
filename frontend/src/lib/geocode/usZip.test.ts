//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { zipMatchesState } from "./usZip.ts";

test("a ZIP in its own state matches, ZIP+4 and lower case included", () => {
  assert.equal(zipMatchesState("75038", "TX"), true);
  assert.equal(zipMatchesState("75038-1234", "tx"), true);
  assert.equal(zipMatchesState("06390", "NY"), true);
});

test("a ZIP from another state does not match", () => {
  assert.equal(zipMatchesState("66666", "TX"), false);
  assert.equal(zipMatchesState("75038", "CA"), false);
});

test("unknown state or unreadable ZIP is never treated as a mismatch", () => {
  assert.equal(zipMatchesState("75038", "ZZ"), true);
  assert.equal(zipMatchesState("abc", "TX"), true);
  assert.equal(zipMatchesState("", ""), true);
});
