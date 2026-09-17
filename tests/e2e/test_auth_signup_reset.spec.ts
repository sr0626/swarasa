// Sign-up + account activation, forgot/reset password, and "keep me signed
// in" (docs/PROJECT_PLAN.csv rows 61-63). Same reality as
// test_auth_redirects.spec.ts: no real Cognito pool/backend here (see
// playwright.config.ts's header) — everything below is testable without
// one (page rendering, client-side zod validation, prefill-from-query
// wiring, the new login-page affordances). Anything that needs a real
// Cognito signUp()/confirmSignUp()/resetPassword()/confirmResetPassword()
// call is `test.fixme()` with a reason, matching this suite's existing
// convention.
import { test, expect } from "@playwright/test";

test.describe("sign-up page", () => {
  test("renders both account-type options and the form fields", async ({
    page,
  }) => {
    await page.goto("/signup");
    await expect(
      page.getByRole("heading", { name: "Create an Account" })
    ).toBeVisible();
    await expect(page.getByLabel("I'm a diner")).toBeVisible();
    await expect(
      page.getByLabel("I own or manage a restaurant")
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    // registered_user is the default (least-privileged, matches
    // backend/app/dependencies/auth.py's no-group fallback).
    await expect(page.getByLabel("I'm a diner")).toBeChecked();
  });

  test("client-side validation blocks an empty submit with no network call", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
    // Still on /signup — no signUp() call was attempted.
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("mismatched passwords are caught before any Cognito call", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("diner@example.com");
    await page.getByLabel("Password", { exact: true }).fill("Password1");
    await page.getByLabel("Confirm password").fill("Password2");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test("links to sign in for an existing account", async ({ page }) => {
    await page.goto("/signup");
    // Scoped to the form: TopBar also has a "Sign In" nav link at desktop
    // widths, and getByRole's name match is case-insensitive, so an
    // unscoped query matches both.
    await page
      .locator("form")
      .getByRole("link", { name: "Sign in" })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test.fixme(
    "owner sign-up actually creates a Cognito user in the owner group",
    async ({ page }) => {
      // Needs: a real Cognito pool, AND the post-confirmation Lambda
      // trigger this PR hands back to Infra/Backend (see SignUpForm.tsx's
      // header comment) — today custom:role is set at sign-up but nothing
      // reads it yet, so a self-signed-up owner lands with no group.
      await page.goto("/signup");
    }
  );
  test.fixme(
    "diner sign-up creates a working registered_user account end-to-end",
    async ({ page }) => {
      // Needs: a real Cognito pool (this path needs no Lambda trigger —
      // no-group already falls back to registered_user, see
      // backend/app/dependencies/auth.py's `_extract_role`).
      await page.goto("/signup");
    }
  );
});

test.describe("confirm sign-up (activation) page", () => {
  test("prefills email from the query string", async ({ page }) => {
    await page.goto("/signup/confirm?email=diner%40example.com");
    await expect(
      page.getByRole("heading", { name: "Confirm Your Account" })
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("diner@example.com");
    await expect(page.getByLabel("Verification code")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resend code" })
    ).toBeVisible();
  });

  test("code is required before submitting", async ({ page }) => {
    await page.goto("/signup/confirm?email=diner%40example.com");
    await page.getByRole("button", { name: "Confirm Account" }).click();
    await expect(page.getByText("Enter the code from your email")).toBeVisible();
  });

  test.fixme(
    "a real confirmation code confirms the account and redirects to /login?confirmed=1",
    async ({ page }) => {
      // Needs: a real Cognito pool and a real pending unconfirmed user.
      await page.goto("/signup/confirm?email=diner%40example.com");
    }
  );
  test.fixme(
    "resend code actually sends a new email",
    async ({ page }) => {
      // Needs: a real Cognito pool.
      await page.goto("/signup/confirm?email=diner%40example.com");
    }
  );
});

test.describe("forgot password", () => {
  test("request page renders and validates email", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(
      page.getByRole("heading", { name: "Forgot Password" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Send Reset Code" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();
  });

  test("confirm page prefills email and validates the new-password fields", async ({
    page,
  }) => {
    await page.goto("/forgot-password/confirm?email=diner%40example.com");
    await expect(
      page.getByRole("heading", { name: "Reset Password" })
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("diner@example.com");
    await page.getByLabel("Reset code").fill("123456");
    // exact: true — "New password" is otherwise a substring match of
    // "Confirm new password" too.
    await page.getByLabel("New password", { exact: true }).fill("Password1");
    await page.getByLabel("Confirm new password").fill("Password2");
    await page
      .getByRole("button", { name: "Reset Password" })
      .click();
    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test.fixme(
    "a real reset code actually resets the password and redirects to /login?reset=1",
    async ({ page }) => {
      // Needs: a real Cognito pool and a real pending reset request.
      await page.goto("/forgot-password/confirm?email=diner%40example.com");
    }
  );
});

test.describe("login page additions", () => {
  test("shows the remember-me checkbox, forgot-password link, and sign-up link", async ({
    page,
  }) => {
    await page.goto("/login");
    const remember = page.getByLabel("Keep me signed in");
    await expect(remember).toBeVisible();
    await expect(remember).not.toBeChecked();
    await expect(
      page.getByRole("link", { name: "Forgot your password?" })
    ).toHaveAttribute("href", "/forgot-password");
    await expect(
      page.getByRole("link", { name: "Create an account" })
    ).toHaveAttribute("href", "/signup");
  });

  test("shows the confirmed banner after activation redirect", async ({
    page,
  }) => {
    await page.goto("/login?confirmed=1");
    await expect(
      page.getByText("Your account is confirmed — sign in below.")
    ).toBeVisible();
  });

  test("shows the reset banner after password-reset redirect", async ({
    page,
  }) => {
    await page.goto("/login?reset=1");
    await expect(
      page.getByText(
        "Your password has been reset — sign in with your new password."
      )
    ).toBeVisible();
  });

  test.fixme(
    "checking 'keep me signed in' mints a 14-day cookie and the silent-refresh loop keeps a real session alive past the 1-hour access-token TTL",
    async ({ page }) => {
      // Needs: a real Cognito pool. See lib/auth/sessionKeepAlive.ts's
      // header for the documented scope of what this achieves and its
      // hard-reload gap.
      await page.goto("/login");
    }
  );
});
