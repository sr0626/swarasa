// Owner portal (tests/CLAUDE.md Phase 1 checklist: "Owner can edit basic
// listing info (free tier)", "Owner cannot access another owner's
// listing"). The unauthenticated-redirect half of this is real and covered
// in test_auth_redirects.spec.ts ("/portal/dashboard", "/portal/locations/1").
//
// Everything below needs a real signed-in owner session plus real seeded
// data (a brand/location owned by that test user, and a second owner's
// location to prove the boundary against) — see fixtures/auth.ts for what's
// missing and what unblocks it.
import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.fixme("owner sees their brands and locations on the dashboard", async ({ page }) => {
  // Needs: a real owner session with at least one seeded restaurant_brand +
  // restaurant_location, fetched via the real owner-scoped GET /restaurants.
  await loginAs(page, "owner");
  await page.goto("/portal/dashboard");
});

test.fixme(
  "owner sees tier/billing status, active/inactive state, and assigned managers per location",
  async ({ page }) => {
    // docs/PROJECT_PLAN.csv "Owner dashboard: richer restaurant table
    // (tier/billing status, active/inactive, assigned managers per
    // restaurant)" — BrandCard.tsx renders LocationTierBadge,
    // LocationStatusBadge, and LocationManagersSummary per location row.
    // Needs: a real owner session with at least one free-tier location,
    // one paid-tier location, and one location with an actively assigned
    // manager (to exercise all three non-empty-state branches), plus real
    // seeded data for the "no managers assigned" empty state.
    await loginAs(page, "owner");
    await page.goto("/portal/dashboard");

    // Tier: a free-tier location shows "Free tier"; a paid-tier location
    // shows "Paid" (no date suffix expected yet — paid_until isn't
    // serialized by the backend today, see the flagged contract gap on
    // LocationSummary.paid_until in frontend/src/types/location.ts).
    await expect(page.getByText("Free tier").first()).toBeVisible();
    await expect(page.getByText(/^Paid\b/).first()).toBeVisible();

    // Active/inactive: renders "Active" today for every listed location
    // (is_active isn't serialized yet either, and the owner-scoped list
    // endpoint currently filters to is_active=true only — same flagged
    // gap). Once Backend closes that gap this assertion should be
    // extended to also cover an "Inactive" row.
    await expect(page.getByText("Active").first()).toBeVisible();

    // Managers: at least one location shows an assigned-manager summary,
    // and at least one shows the empty state.
    await expect(page.getByText(/\d+ managers?:/).first()).toBeVisible();
    await expect(page.getByText("No managers assigned").first()).toBeVisible();
  }
);

test.fixme(
  "owner can edit basic listing info for their own location (free tier)",
  async ({ page }) => {
    // Needs: real owner session + a real owned location id, exercising
    // LocationInfoForm.tsx against the real PUT /locations/{id}.
    await loginAs(page, "owner");
  }
);

test.fixme(
  "owner cannot access another owner's location editor (gets the generic not-found/no-access panel)",
  async ({ page }) => {
    // frontend/src/app/portal/locations/[id]/page.tsx already has the
    // right shape for this: a 403 from GET /locations/{id}/managers
    // renders the SAME NotFoundOrNoAccess panel as a real 404, so an
    // unauthorized owner can't distinguish "doesn't exist" from "exists,
    // not yours." Needs two real owners and a location owned by the
    // *other* one to actually exercise that server-side check — currently
    // nothing to log in as or a second owner's location id to hit.
    await loginAs(page, "owner");
  }
);
