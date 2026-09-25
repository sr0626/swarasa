// Unit tests for the one-top-bar-menu-open-at-a-time bus.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { announceMenuOpen, onOtherMenuOpen } from "./exclusiveMenu.ts";

test("opening one menu closes the others but not itself", () => {
  const closed: string[] = [];
  const offA = onOtherMenuOpen("hamburger", () => closed.push("hamburger"));
  const offB = onOtherMenuOpen("account", () => closed.push("account"));
  const offC = onOtherMenuOpen("bell", () => closed.push("bell"));

  announceMenuOpen("account");
  assert.deepEqual(closed.sort(), ["bell", "hamburger"]);

  offA();
  offB();
  offC();
});

test("an unsubscribed menu is no longer told to close", () => {
  let calls = 0;
  const off = onOtherMenuOpen("hamburger", () => {
    calls += 1;
  });
  announceMenuOpen("account");
  assert.equal(calls, 1);
  off();
  announceMenuOpen("account");
  assert.equal(calls, 1);
});
