// Unauthed access to gated pages — this part of the Phase 1 checklist IS
// testable today without a real Cognito pool: `requireSession()`
// (frontend/src/lib/auth/guards.ts) calls `getServerSession()`
// (frontend/src/lib/auth/session.ts), which reads the `rp_access_token`
// cookie and returns null immediately when it's absent — no Cognito
// network call happens on the "signed out" path, so this doesn't need a
// real pool to exercise honestly. Confirmed by reading both files.
//
// This covers the "unauthed user cannot access X" half of the relevant
// Phase 1 checklist items. It does NOT cover role boundaries (owner vs
// manager vs admin) — that needs a real signed-in session, see
// test_owner_portal.spec.ts / test_manager_portal.spec.ts / the skipped
// half of test_claim_flow.spec.ts.
import { test, expect } from "@playwright/test";

const GATED_PAGES: Array<{ path: string; label: string }> = [
  { path: "/claim?brand_id=1", label: "claim page" },
  { path: "/portal/dashboard", label: "owner/manager dashboard" },
  { path: "/portal/locations/1", label: "location editor" },
  { path: "/admin/claims", label: "admin claims queue" },
  { path: "/account", label: "account/profile page" },
  { path: "/account/security", label: "account security/change-password page" },
];

for (const { path, label } of GATED_PAGES) {
  test(`unauthenticated user is redirected from ${label} (${path}) to /login`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  });
}
