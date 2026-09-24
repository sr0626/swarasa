// Run with: cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { dealSignInHref, pathAllowedForRole } from "./safeNext.ts";

test("pathAllowedForRole: Add location is owner/admin, Add restaurant owner-only", () => {
  const addLocation = "/portal/locations/new?brand=3";
  assert.equal(pathAllowedForRole(addLocation, "owner"), true);
  assert.equal(pathAllowedForRole(addLocation, "admin"), true);
  assert.equal(pathAllowedForRole(addLocation, "manager"), false);
  assert.equal(pathAllowedForRole(addLocation, "registered_user"), false);
  assert.equal(pathAllowedForRole("/portal/brands/new", "admin"), false);
  // Unchanged: the editor itself stays owner/manager for post-login redirects.
  assert.equal(pathAllowedForRole("/portal/locations/10", "manager"), true);
});

test("dealSignInHref returns to the current page after sign-in", () => {
  assert.equal(
    dealSignInHref("/restaurant/spice-garden"),
    "/login?next=%2Frestaurant%2Fspice-garden"
  );
  assert.equal(
    dealSignInHref("/search?location=Plano&cuisine=south-indian"),
    "/login?next=%2Fsearch%3Flocation%3DPlano%26cuisine%3Dsouth-indian"
  );
});

test("dealSignInHref drops an unsafe next path (no open redirect)", () => {
  assert.equal(dealSignInHref("https://evil.com"), "/login");
  assert.equal(dealSignInHref("//evil.com"), "/login");
  assert.equal(dealSignInHref("/a\\b"), "/login");
});
