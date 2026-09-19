// Role-aware account/profile page — docs/PROJECT_PLAN.csv "User profile /
// account details page (role-aware: registered_user, owner, manager,
// admin)". No profile page existed anywhere before this (checked
// frontend/src/app) despite GET/PATCH /auth/me and the CCPA export/
// deletion endpoints (PR #70) already being Done on the backend with zero
// frontend consumer.
//
// Route choice `/account` (flagged in this PR's description): every role
// can reach this page, same posture as `/login` — not nested under
// `/portal` (owner/manager-gated) or `/admin` (admin-gated), which are
// role-restricted areas. `requireSession` below allows all four roles.
//
// JUDGMENT CALL — role branching (flagged in this PR's description): the
// task brief assumed `PATCH /auth/me` was editable by every role. The real
// contract (docs/API_CONTRACTS.md "PATCH /auth/me") is "Auth: owner" only
// (backend/app/routers/auth.py's `update_me` uses `Depends(require_owner)`).
// So only an owner session gets the edit form; manager/admin/
// registered_user get a read-only name/email display with a short note —
// building an edit form that would just 403 for those roles would be
// worse than not having one.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import { ApiError } from "@/lib/api/client";
import {
  getCurrentUser,
  getMyDataDeletionRequests,
  getMyFollows,
  getMyManagedLocations,
} from "@/lib/api/auth";
import { getMyRestaurants } from "@/lib/api/restaurants";
import ProfileEditForm from "@/components/account/ProfileEditForm";
import FollowedRestaurantsList from "@/components/account/FollowedRestaurantsList";
import ManagedLocationsList from "@/components/account/ManagedLocationsList";
import OwnerRestaurantsList from "@/components/account/OwnerRestaurantsList";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import InfoPanel from "@/components/ui/InfoPanel";
import type { AuthMe } from "@/types/auth";
import type { FollowedBrand } from "@/types/follow";
import type { ManagedLocation } from "@/types/location";
import type { DataDeletionRequest } from "@/types/privacy";
import type { RestaurantBrand } from "@/types/restaurant";

export const metadata: Metadata = {
  title: "My Account",
};

const ROLE_LABEL: Record<AuthMe["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  admin: "Admin",
  registered_user: "Registered user",
};

export default async function AccountPage() {
  const session = await requireSession(["owner", "manager", "admin", "registered_user"]);

  let me: AuthMe | null = null;
  let meError: string | null = null;
  try {
    me = await getCurrentUser(session.accessToken);
  } catch (error) {
    meError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading your account. Please try again.";
  }

  let follows: FollowedBrand[] = [];
  let followsError: string | null = null;
  if (me && me.role === "registered_user") {
    try {
      const page = await getMyFollows({ page: 1, page_size: 50 }, session.accessToken);
      follows = page.results;
    } catch (error) {
      followsError =
        error instanceof ApiError
          ? error.message
          : "Could not load your followed restaurants. Please try again.";
    }
  }

  let ownedBrands: RestaurantBrand[] = [];
  let ownedBrandsError: string | null = null;
  if (me && me.role === "owner") {
    try {
      const page = await getMyRestaurants({ page: 1, page_size: 50 }, session.accessToken);
      ownedBrands = page.results;
    } catch (error) {
      ownedBrandsError =
        error instanceof ApiError
          ? error.message
          : "Could not load your restaurants. Please try again.";
    }
  }

  let managedLocations: ManagedLocation[] = [];
  let managedLocationsError: string | null = null;
  if (me && me.role === "manager") {
    try {
      const page = await getMyManagedLocations({ page: 1, page_size: 50 }, session.accessToken);
      managedLocations = page.results;
    } catch (error) {
      managedLocationsError =
        error instanceof ApiError
          ? error.message
          : "Could not load your assigned locations. Please try again.";
    }
  }

  // Best-effort — the privacy section still renders (just without a known
  // "already pending" state) if this call fails, since it isn't essential
  // to reading the page.
  let latestDeletionRequest: DataDeletionRequest | null = null;
  if (me) {
    try {
      const page = await getMyDataDeletionRequests({ page: 1, page_size: 5 }, session.accessToken);
      latestDeletionRequest =
        [...page.results].sort(
          (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        )[0] ?? null;
    } catch {
      latestDeletionRequest = null;
    }
  }

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">My Account</h1>
        <p className="mt-2 text-sm text-brand-ink-muted">
          Your profile, {me?.role === "owner" ? "your restaurants, " : ""}
          {me?.role === "registered_user" ? "followed restaurants, " : ""}
          {me?.role === "manager" ? "assigned locations, " : ""}
          and data privacy settings.
        </p>

        <div className="mt-6 flex flex-col gap-5">
          {meError && <InfoPanel title="Couldn't load your account" body={meError} />}

          {me && (
            <>
              <section className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
                <h2 className="font-display text-xl font-bold text-brand-ink">
                  {me.owner_account?.full_name ?? me.email}
                </h2>
                <p className="mt-1 text-sm text-brand-ink-muted">{me.email}</p>
                <span className="mt-2 inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
                  {ROLE_LABEL[me.role]}
                </span>
              </section>

              {me.role === "owner" && me.owner_account && (
                <ProfileEditForm ownerAccount={me.owner_account} />
              )}

              {me.role === "owner" && (
                <OwnerRestaurantsList brands={ownedBrands} loadError={ownedBrandsError} />
              )}

              {me.role !== "owner" && (
                <InfoPanel
                  title="Profile editing isn't available for this role yet"
                  body="Name/email changes are currently owner-only. Contact support if your details need to change."
                />
              )}

              {me.role === "registered_user" && (
                <FollowedRestaurantsList follows={follows} loadError={followsError} />
              )}

              {me.role === "manager" && (
                <ManagedLocationsList
                  locations={managedLocations}
                  loadError={managedLocationsError}
                />
              )}

              {/* Minimal admin entry point for the report triage queue
                  (/admin/reports). AccountMenu has no role awareness and
                  TopBarShell is owned elsewhere, so this is the reachable
                  spot until a header link is added. */}
              {me.role === "admin" && (
                <section className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
                  <h2 className="font-display text-lg font-bold text-brand-ink">Admin</h2>
                  <Link
                    href="/admin/reports"
                    className="mt-3 inline-flex min-h-[44px] items-center rounded-brand-pill border border-brand-ink px-5 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip"
                  >
                    Reports
                  </Link>
                </section>
              )}

              <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
