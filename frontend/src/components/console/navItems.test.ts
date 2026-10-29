import test from "node:test";
import assert from "node:assert/strict";
import {
  activeNavHref,
  ADMIN_NAV_GROUPS,
  ADMIN_NAV_ITEMS,
  ADMIN_NAV_MENU,
  flattenNavMenu,
  groupForPath,
  MANAGER_NAV_ITEMS,
  OWNER_NAV_ITEMS,
} from "./navItems.ts";

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

test("Contact admin is a menu item for owner and manager; Messages for admin", () => {
  for (const items of [OWNER_NAV_ITEMS, MANAGER_NAV_ITEMS]) {
    assert.ok(
      items.some((i) => i.href === "/portal/contact-admin" && i.label === "Contact admin")
    );
    assert.equal(activeNavHref("/portal/contact-admin", items), "/portal/contact-admin");
  }
  assert.ok(ADMIN_NAV_ITEMS.some((i) => i.href === "/admin/messages" && i.label === "Messages"));
  assert.equal(activeNavHref("/admin/messages", ADMIN_NAV_ITEMS), "/admin/messages");
});

test("admin menu has Users and Audit log, each highlighted only on its own page", () => {
  assert.ok(ADMIN_NAV_ITEMS.some((i) => i.href === "/admin/users" && i.label === "Users"));
  assert.ok(ADMIN_NAV_ITEMS.some((i) => i.href === "/admin/audit-log" && i.label === "Audit log"));
  assert.equal(activeNavHref("/admin/users", ADMIN_NAV_ITEMS), "/admin/users");
  assert.equal(activeNavHref("/admin/audit-log", ADMIN_NAV_ITEMS), "/admin/audit-log");
  assert.equal(activeNavHref("/admin/registered-users", ADMIN_NAV_ITEMS), "/admin/registered-users");
});

test("no menu href points at the old in-page #activity anchor", () => {
  const all = [...OWNER_NAV_ITEMS, ...MANAGER_NAV_ITEMS];
  for (const i of all) {
    assert.notEqual(i.href, "/account#activity");
    for (const s of i.subItems ?? []) assert.notEqual(s.href, "/account#activity");
  }
});

test("admin menu has Taxonomy, highlighted on its own page", () => {
  assert.ok(ADMIN_NAV_ITEMS.some((i) => i.href === "/admin/taxonomy" && i.label === "Taxonomy"));
  assert.equal(activeNavHref("/admin/taxonomy", ADMIN_NAV_ITEMS), "/admin/taxonomy");
});

test("admin menu order: Overview first, then Listings, People, Work queue, System (Profile last)", () => {
  const labels = ADMIN_NAV_ITEMS.map((i) => i.label);
  assert.equal(labels[0], "Overview");
  assert.equal(labels[labels.length - 1], "Profile");
  const idx = (l: string) => labels.indexOf(l);
  assert.ok(idx("Taxonomy") < idx("Users"));
  assert.ok(idx("Registered users") < idx("Claims"));
  assert.ok(idx("Reopen requests") < idx("Audit log"));
  assert.equal(new Set(labels).size, labels.length);
});

const ADMIN_GROUP_ITEMS: Record<string, string[]> = {
  Listings: ["Listings", "Import", "Taxonomy"],
  People: ["Users", "Owners", "Managers", "Registered users"],
  "Work queue": ["Claims", "Messages", "Reports", "Reopen requests"],
  System: ["Audit log", "Profile"],
};

test("admin menu groups: Overview on top, then the four groups with the agreed members", () => {
  assert.deepEqual(ADMIN_NAV_MENU.top.map((i) => i.label), ["Overview"]);
  assert.deepEqual(ADMIN_NAV_GROUPS.map((g) => g.title), Object.keys(ADMIN_GROUP_ITEMS));
  for (const g of ADMIN_NAV_GROUPS) assert.deepEqual(g.items.map((i) => i.label), ADMIN_GROUP_ITEMS[g.title]);
});

test("admin menu: every item appears exactly once and ADMIN_NAV_ITEMS is the flat grouped order", () => {
  const hrefs = ADMIN_NAV_ITEMS.map((i) => i.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.equal(ADMIN_NAV_ITEMS.length, 14);
  assert.deepEqual(hrefs, flattenNavMenu(ADMIN_NAV_MENU).map((i) => i.href));
  assert.deepEqual(
    ADMIN_NAV_ITEMS.map((i) => i.label),
    ["Overview", ...Object.values(ADMIN_GROUP_ITEMS).flat()]
  );
});

test("admin menu groups: only Listings is open by default; ids are unique", () => {
  assert.deepEqual(ADMIN_NAV_GROUPS.filter((g) => g.defaultOpen).map((g) => g.title), ["Listings"]);
  assert.equal(new Set(ADMIN_NAV_GROUPS.map((g) => g.id)).size, ADMIN_NAV_GROUPS.length);
});

test("activeNavHref resolves every admin path, including nested ones", () => {
  for (const { href } of ADMIN_NAV_ITEMS) {
    assert.equal(activeNavHref(href, ADMIN_NAV_ITEMS), href);
    assert.equal(activeNavHref(`${href}/some-id`, ADMIN_NAV_ITEMS), href);
  }
});

test("groupForPath returns the group holding the active page (nested paths too), null for Overview", () => {
  assert.equal(groupForPath("/admin/claims")?.title, "Work queue");
  assert.equal(groupForPath("/admin/claims/abc-123")?.title, "Work queue");
  assert.equal(groupForPath("/admin/taxonomy")?.title, "Listings");
  assert.equal(groupForPath("/admin/registered-users")?.title, "People");
  assert.equal(groupForPath("/admin/users")?.title, "People");
  assert.equal(groupForPath("/admin/audit-log")?.title, "System");
  assert.equal(groupForPath("/account")?.title, "System");
  assert.equal(groupForPath("/admin/overview"), null);
  assert.equal(groupForPath("/somewhere/else"), null);
  for (const g of ADMIN_NAV_GROUPS) for (const i of g.items) assert.equal(groupForPath(i.href)?.id, g.id);
});
