// Unit tests for the admin Users directory view helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  USER_ROLES,
  USER_SORTS,
  USER_STATUSES,
  actionConfirmText,
  actionErrorMessage,
  availableActions,
  buildUsersHref,
  parseOption,
  statusChips,
} from "./adminUsersView.ts";

test("parseOption accepts only known values", () => {
  for (const role of USER_ROLES) assert.equal(parseOption(role, USER_ROLES), role);
  for (const status of USER_STATUSES) assert.equal(parseOption(status, USER_STATUSES), status);
  assert.equal(parseOption("bogus", USER_ROLES), undefined);
  assert.equal(parseOption(undefined, USER_STATUSES), undefined);
  assert.equal(parseOption("newest", USER_SORTS), "newest");
});

test("buildUsersHref omits defaults and encodes search text", () => {
  assert.equal(buildUsersHref({}), "/admin/users");
  assert.equal(buildUsersHref({ sort: "newest", page: 1 }), "/admin/users");
  assert.equal(
    buildUsersHref({ q: "a b&c", role: "owner", status: "disabled", sort: "email", page: 3 }),
    "/admin/users?q=a+b%26c&role=owner&status=disabled&sort=email&page=3"
  );
});

test("statusChips always spell out enabled and confirmed state in text", () => {
  assert.deepEqual(
    statusChips({ enabled: true, confirmed: true, status: "CONFIRMED" }).map((c) => c.label),
    ["Enabled", "Confirmed"]
  );
  assert.deepEqual(
    statusChips({ enabled: false, confirmed: false, status: "UNCONFIRMED" }).map((c) => c.label),
    ["Disabled", "Unconfirmed"]
  );
  assert.ok(
    statusChips({ enabled: true, confirmed: true, status: "RESET_REQUIRED" }).some(
      (c) => c.label === "Password reset pending"
    )
  );
});

test("availableActions mirrors the server rules", () => {
  assert.deepEqual(availableActions({ enabled: true, confirmed: true, is_self: false }), [
    "disable",
    "reset-password",
  ]);
  assert.deepEqual(availableActions({ enabled: false, confirmed: true, is_self: false }), [
    "enable",
    "reset-password",
  ]);
  assert.deepEqual(availableActions({ enabled: true, confirmed: false, is_self: false }), [
    "confirm",
    "disable",
    "reset-password",
  ]);
  // Never disable/reset yourself.
  assert.deepEqual(availableActions({ enabled: true, confirmed: true, is_self: true }), []);
});

test("action copy names the person and error copy never leaks internals", () => {
  assert.match(actionConfirmText("disable", "a@x.com"), /a@x\.com/);
  assert.match(actionConfirmText("reset-password", "a@x.com"), /Forgot password/);
  assert.equal(actionErrorMessage(404, "x"), "That user no longer exists. Refresh the list.");
  assert.equal(actionErrorMessage(500, "stack trace"), "Something went wrong. Please try again.");
  assert.equal(actionErrorMessage(409, "This is the last remaining admin account."), "This is the last remaining admin account.");
});
