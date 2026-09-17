// Mobile viewport (375px): no horizontal scroll on any Phase 1 page.
// tests/CLAUDE.md Phase 1 checklist, explicit requirement (also "ALWAYS
// test on mobile viewport (375px) for all user-facing pages").
//
// Runs under the "mobile-375" project (playwright.config.ts), which sets a
// 375x812 viewport. The check itself: document.scrollWidth must not exceed
// the viewport's clientWidth — if it does, something is overflowing and
// forcing horizontal scroll.
import { test, expect } from "@playwright/test";

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test("homepage has no horizontal scroll at 375px", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Discover your taste." })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("search results page has no horizontal scroll at 375px", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Search results" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("restaurant detail page (error boundary state) has no horizontal scroll at 375px", async ({
  page,
}) => {
  // No backend deployed — this renders the error boundary for any slug
  // (see test_public_listing.spec.ts for why). Still a real Phase 1 page
  // users can land on, so it's still in scope for the mobile check.
  await page.goto("/restaurant/any-nonexistent-slug");
  // InfoPanel renders its title as a styled <p>, not a heading — see
  // test_public_listing.spec.ts's matching comment.
  await expect(page.getByText("Something went wrong")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("login page has no horizontal scroll at 375px", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("sign-up page has no horizontal scroll at 375px", async ({ page }) => {
  await page.goto("/signup");
  await expect(
    page.getByRole("heading", { name: "Create an Account" })
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("confirm sign-up page has no horizontal scroll at 375px", async ({
  page,
}) => {
  await page.goto("/signup/confirm?email=diner%40example.com");
  await expect(
    page.getByRole("heading", { name: "Confirm Your Account" })
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("forgot-password page has no horizontal scroll at 375px", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("heading", { name: "Forgot Password" })
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("reset-password page has no horizontal scroll at 375px", async ({
  page,
}) => {
  await page.goto("/forgot-password/confirm?email=diner%40example.com");
  await expect(
    page.getByRole("heading", { name: "Reset Password" })
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
});
