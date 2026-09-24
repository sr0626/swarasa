import test from "node:test";
import assert from "node:assert/strict";
import { activeNavHref, MANAGER_NAV_ITEMS, OWNER_NAV_ITEMS } from "./navItems.ts";

test("owner: /account highlights Business account, /account/activity only Activity", () => {
  assert.equal(activeNavHref("/account", OWNER_NAV_ITEMS), "/account");
  assert.equal(activeNavHref("/account/activity", OWNER_NAV_ITEMS), "/account/activity");
  assert.equal(activeNavHref("/portal/brands/new", OWNER_NAV_ITEMS), "/portal/brands/new");
});

test("manager: /account is My locations, /account/activity is Activity", () => {
  assert.equal(activeNavHref("/account", MANAGER_NAV_ITEMS), "/account");
  assert.equal(activeNavHref("/account/activity", MANAGER_NAV_ITEMS), "/account/activity");
});

test("Activity is a menu item for both owner and manager", () => {
  for (const items of [OWNER_NAV_ITEMS, MANAGER_NAV_ITEMS]) {
    assert.ok(items.some((i) => i.href === "/account/activity" && i.label === "Activity"));
  }
});

test("no menu href points at the old in-page #activity anchor", () => {
  const all = [...OWNER_NAV_ITEMS, ...MANAGER_NAV_ITEMS];
  for (const i of all) {
    assert.notEqual(i.href, "/account#activity");
    for (const s of i.subItems ?? []) assert.notEqual(s.href, "/account#activity");
  }
});
