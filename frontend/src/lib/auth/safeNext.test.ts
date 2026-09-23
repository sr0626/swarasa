// Run with: cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { dealSignInHref } from "./safeNext.ts";

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
