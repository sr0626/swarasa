// Signed-in account dropdown in the shared TopBar
// (docs/PROJECT_PLAN.csv "Signed-in account dropdown in site header",
// frontend/src/components/home/TopBar.tsx + AccountMenu.tsx).
//
// Split the same way as the rest of this suite (test_auth_redirects.spec.ts's
// header comment explains the general split): what's honestly testable
// without a real Cognito user pool runs for real below; everything that
// needs an actual signed-in session is `test.fixme` with a comment naming
// exactly what's missing, matching test_account_page.spec.ts's convention.
import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test("signed-out TopBar renders the same 'For Owners' / 'Sign In' nav as before (no account menu)", async ({
  page,
}) => {
  // No `rp_access_token` cookie is set — getServerSession() returns null
  // immediately (no Cognito network call), so this is the same honestly-
  // testable-without-a-real-pool path test_auth_redirects.spec.ts relies on.
  await page.goto("/");
  // `<header>` here is nested inside `<main>` (every page's own layout, e.g.
  // app/page.tsx's `<main><TopBar />...`), which per HTML-AAM means it does
  // NOT get the implicit "banner" landmark role — so a tag locator, not
  // `getByRole("banner")`, is what actually finds it.
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Sign In", exact: true })).toBeVisible();
  await expect(header.getByRole("link", { name: "For Owners", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: /Hello,/ })).toHaveCount(0);
});

test("signed-out TopBar looks the same on every shared page (about/contact/terms/search/login/signup/forgot-password)", async ({
  page,
}) => {
  // Scoped to the header (`<header>` has the implicit "banner" landmark
  // role) — some of these pages have their own unrelated "Sign in" copy in
  // page body content (e.g. ForgotPasswordForm.tsx's "Remembered your
  // password? Sign in" link), which would otherwise make this locator
  // ambiguous.
  for (const path of [
    "/",
    "/login",
    "/search",
    "/about",
    "/contact",
    "/terms",
    "/signup",
    "/forgot-password",
  ]) {
    await page.goto(path);
    await expect(
      page.locator("header").getByRole("link", { name: "Sign In", exact: true })
    ).toBeVisible();
  }
});

test.fixme(
  "signed-in visitor sees 'Hello, {name}' instead of 'For Owners'/'Sign In'",
  async ({ page }) => {
    // Needs: a real Cognito session (see fixtures/auth.ts's header comment
    // for exactly what's blocking this — no deployed user pool yet).
    // Asserts the account menu trigger shows owner_account.full_name (or
    // email fallback) from GET /auth/me, matching app/account/page.tsx's
    // own greeting fallback (PR #80).
    await loginAs(page, "owner");
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Hello,/ })).toBeVisible();
  }
);

test.fixme(
  "account dropdown is keyboard-operable: Enter opens it, Escape closes it and returns focus to the trigger",
  async ({ page }) => {
    // Needs: a real signed-in session, see above.
    await loginAs(page, "owner");
    await page.goto("/");
    const trigger = page.getByRole("button", { name: /Hello,/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Account" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Account" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
);

test.fixme(
  "account dropdown closes on outside click",
  async ({ page }) => {
    await loginAs(page, "owner");
    await page.goto("/");
    await page.getByRole("button", { name: /Hello,/ }).click();
    await expect(page.getByRole("menu", { name: "Account" })).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(page.getByRole("menu", { name: "Account" })).toHaveCount(0);
  }
);

test.fixme(
  "Profile and Security dropdown links navigate to /account and /account/security",
  async ({ page }) => {
    await loginAs(page, "owner");
    await page.goto("/");
    await page.getByRole("button", { name: /Hello,/ }).click();
    await page.getByRole("menuitem", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
  }
);

test.fixme(
  "Logout clears the session: cookies removed, keep-alive stopped, redirected to /, and a reload does not re-establish the signed-in menu",
  async ({ page, context }) => {
    // Needs: a real signed-in session with a live `rp_access_token` cookie
    // to actually exercise the full clear — the DELETE route's own
    // request/response shape (no cookie required to hit it) is covered for
    // real in test_logout_route.spec.ts below instead.
    await loginAs(page, "owner");
    await page.goto("/");
    await page.getByRole("button", { name: /Hello,/ }).click();
    await page.getByRole("menuitem", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "rp_access_token")).toBeUndefined();
    // Reloading must not silently re-establish the signed-in state — proves
    // no session material leaked into e.g. sessionStorage/localStorage as a
    // substitute for the cleared cookie.
    await page.reload();
    await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
  }
);
