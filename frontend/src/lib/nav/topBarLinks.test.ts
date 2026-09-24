// Unit tests for the top bar's role -> links map and active-state rule.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { isTopBarLinkActive, topBarLinksFor } from "./topBarLinks.ts";
import type { TopBarLink } from "./topBarLinks.ts";

const ROLES = ["owner", "manager", "admin", "registered_user", null] as const;

function link(role: (typeof ROLES)[number], key: string): TopBarLink {
  const found = topBarLinksFor(role).find((l) => l.key === key);
  assert.ok(found, `${role} has a "${key}" link`);
  return found;
}

const params = (query = "") => new URLSearchParams(query);

test("every role gets a non-empty link set with unique keys and hrefs", () => {
  for (const role of ROLES) {
    const links = topBarLinksFor(role);
    assert.ok(links.length > 0, `${role} has links`);
    assert.equal(new Set(links.map((l) => l.key)).size, links.length);
    assert.equal(new Set(links.map((l) => l.href)).size, links.length);
    for (const l of links) assert.ok(!l.href.includes("#"), `${l.href} has no hash`);
  }
});

test("signed-out set: browse links plus the add-your-restaurant CTA routed via login", () => {
  const links = topBarLinksFor(null);
  assert.deepEqual(
    links.map((l) => l.label),
    ["Find restaurants", "Deals today", "About", "Add your restaurant"],
  );
  assert.equal(links.find((l) => l.cta)?.href, "/login?next=/portal/brands/new");
  // No second "sign in" style link in the middle: Sign in lives on the right.
  assert.ok(!links.some((l) => /sign in/i.test(l.label)));
});

test("signed-in role sets", () => {
  assert.deepEqual(
    topBarLinksFor("registered_user").map((l) => l.href),
    ["/search", "/search?deals_today=true", "/account"],
  );
  assert.deepEqual(
    topBarLinksFor("owner").map((l) => l.href),
    ["/account", "/search", "/portal/brands/new"],
  );
  assert.deepEqual(
    topBarLinksFor("manager").map((l) => l.href),
    ["/account", "/search"],
  );
  assert.deepEqual(
    topBarLinksFor("admin").map((l) => l.href),
    ["/admin/overview", "/admin/claims", "/admin/reports", "/admin/listings", "/admin/owners"],
  );
});

test("only owner and signed-out see the add-restaurant CTA (POST /restaurants is owner-only)", () => {
  for (const role of ROLES) {
    const hasCta = topBarLinksFor(role).some((l) => l.cta);
    assert.equal(hasCta, role === "owner" || role === null, String(role));
  }
  assert.equal(topBarLinksFor("owner").find((l) => l.cta)?.href, "/portal/brands/new");
});

test("Find restaurants vs Deals today are told apart by deals_today=true on /search", () => {
  const find = link("registered_user", "find");
  const deals = link("registered_user", "deals");
  assert.equal(isTopBarLinkActive(find, "/search", params("q=biryani")), true);
  assert.equal(isTopBarLinkActive(deals, "/search", params("q=biryani")), false);
  assert.equal(isTopBarLinkActive(find, "/search", params("deals_today=true")), false);
  assert.equal(isTopBarLinkActive(deals, "/search", params("deals_today=true")), true);
  assert.equal(isTopBarLinkActive(find, "/search", params("deals_today=false")), true);
  assert.equal(isTopBarLinkActive(find, "/search", null), true);
  assert.equal(isTopBarLinkActive(deals, "/search", null), false);
});

test("search links are inactive elsewhere", () => {
  const find = link("owner", "find");
  assert.equal(isTopBarLinkActive(find, "/", params()), false);
  assert.equal(isTopBarLinkActive(find, "/searchers", params()), false);
});

test("path links match exactly or as a parent, never as a prefix of a sibling", () => {
  const claims = link("admin", "claims");
  assert.equal(isTopBarLinkActive(claims, "/admin/claims", params()), true);
  assert.equal(isTopBarLinkActive(claims, "/admin/claims/42", params()), true);
  assert.equal(isTopBarLinkActive(claims, "/admin/claims-archive", params()), false);
  assert.equal(isTopBarLinkActive(claims, "/admin/overview", params()), false);

  const mine = link("owner", "mine");
  assert.equal(isTopBarLinkActive(mine, "/account", params()), true);
  assert.equal(isTopBarLinkActive(mine, "/account/security", params()), true);
  assert.equal(isTopBarLinkActive(mine, "/", params()), false);
});

test("the signed-out CTA (a /login link) is never active, so it doesn't mirror Sign in", () => {
  const cta = link(null, "add");
  assert.equal(isTopBarLinkActive(cta, "/login", params("next=/portal/brands/new")), false);
});

test("the owner CTA is active on its own page", () => {
  assert.equal(isTopBarLinkActive(link("owner", "add"), "/portal/brands/new", params()), true);
});
