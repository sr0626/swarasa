// Role-aware /account page (docs/PROJECT_PLAN.csv "User profile / account
// details page"). The unauthed-redirect half is covered in
// test_auth_redirects.spec.ts alongside the other gated pages. Everything
// below needs a real signed-in Cognito session per role, same limitation as
// test_owner_portal.spec.ts / test_manager_portal.spec.ts.
import { test } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.fixme("owner sees an editable profile form on /account", async ({ page }) => {
  // Needs: a real owner session. PATCH /auth/me is owner-only
  // (docs/API_CONTRACTS.md), so this is the one role that gets
  // ProfileEditForm.tsx instead of the read-only notice.
  await loginAs(page, "owner");
  await page.goto("/account");
});

test.fixme(
  "manager, admin, and registered_user see a read-only profile notice on /account",
  async ({ page }) => {
    // Needs: real sessions for each of the 3 non-owner roles, asserting
    // ProfileEditForm.tsx is NOT rendered and the "owner-only" InfoPanel is.
    await loginAs(page, "manager");
    await page.goto("/account");
  }
);

test.fixme(
  "manager sees their assigned locations via GET /auth/me/managed-locations",
  async ({ page }) => {
    // Needs: a real manager session with at least one active location_manager
    // assignment (PR #78's new endpoint) to exercise ManagedLocationsList.tsx
    // against real data instead of its empty state.
    await loginAs(page, "manager");
    await page.goto("/account");
  }
);

test.fixme(
  "registered_user sees their followed restaurants via GET /auth/me/follows",
  async ({ page }) => {
    // Needs: a real registered_user session with at least one followed
    // brand to exercise FollowedRestaurantsList.tsx against real data.
    await loginAs(page, "registered_user");
    await page.goto("/account");
  }
);

test.fixme(
  "any role can download their data export from /account",
  async ({ page }) => {
    // Needs: a real session — exercises GET /auth/me/data-export via
    // DataPrivacySection.tsx's "Download my data" button and the browser
    // download it triggers.
    await loginAs(page, "registered_user");
    await page.goto("/account");
  }
);

test.fixme(
  "any role can submit a data deletion request from /account, with a confirm step",
  async ({ page }) => {
    // Needs: a real session — exercises POST /auth/me/data-deletion via
    // DataPrivacySection.tsx's confirm-then-submit flow, and that a second
    // attempt while one is pending_review shows the disabled
    // "already pending" state instead of allowing a duplicate.
    await loginAs(page, "registered_user");
    await page.goto("/account");
  }
);
