// DELETE /api/auth/session (frontend/src/app/api/auth/session/route.ts) —
// the server-side half of Logout (components/home/AccountMenu.tsx,
// docs/PROJECT_PLAN.csv "Signed-in account dropdown in site header").
//
// Unlike the rest of the account-dropdown flow (test_account_dropdown.spec.ts),
// this route's own request/response shape and cookie-clearing behavior
// don't need a real signed-in Cognito session to exercise honestly: DELETE
// never verifies the token, it just deletes the two cookies by name (see
// the route's own comment) — a fake, unverifiable cookie value is enough
// to prove the clearing behavior for real.
import { test, expect } from "@playwright/test";

test("DELETE /api/auth/session clears rp_access_token and rp_remember_me and returns 200", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost:3100").origin;
  await context.addCookies([
    { name: "rp_access_token", value: "fake-token-not-real", url: origin },
    { name: "rp_remember_me", value: "1", url: origin },
  ]);

  let cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "rp_access_token")).toBeDefined();
  expect(cookies.find((c) => c.name === "rp_remember_me")).toBeDefined();

  const res = await page.request.delete("/api/auth/session");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);

  cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "rp_access_token")).toBeUndefined();
  expect(cookies.find((c) => c.name === "rp_remember_me")).toBeUndefined();
});

test("DELETE /api/auth/session is a no-op success when no session cookie was present", async ({
  page,
}) => {
  const res = await page.request.delete("/api/auth/session");
  expect(res.status()).toBe(200);
});

test("after DELETE /api/auth/session, an auth-gated page still redirects to /login (no stale server-side session)", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://localhost:3100").origin;
  await context.addCookies([
    { name: "rp_access_token", value: "fake-token-not-real", url: origin },
  ]);
  await page.request.delete("/api/auth/session");

  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
});
