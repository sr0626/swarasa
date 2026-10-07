// What the signed-in-only /privacy page offers each role. Plain data so the
// rule is unit-testable without rendering the page.
//
// Admins are platform staff, not data subjects of this app: they get an
// explanatory note instead of the CCPA export / deletion-request controls.
// The backend endpoints are unchanged and still accept any role.
import type { DataDeletionRequest } from "@/types/privacy";
import type { UserRole } from "@/types/auth";

export type PrivacyPageMode = "controls" | "staff-note";

export function privacyPageModeFor(role: UserRole): PrivacyPageMode {
  return role === "admin" ? "staff-note" : "controls";
}

/** Newest deletion request by `submitted_at`, or null when there are none. */
export function latestDeletionRequestOf(
  requests: ReadonlyArray<DataDeletionRequest>,
): DataDeletionRequest | null {
  return (
    [...requests].sort(
      (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime(),
    )[0] ?? null
  );
}
