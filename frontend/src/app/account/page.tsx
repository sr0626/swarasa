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
// contract (docs/API_CONTRACTS.md "PATCH /auth/me") historically was
// "Auth: owner" only; PR #83 broadened the route itself to any authenticated
// role, but `owner_account` remains the only local record with a name to
// edit, so admin/registered_user still get a read-only display (manager
// now gets a real, generic name-only edit form -- see
// components/account/NameEditForm.tsx and its cross-PR dependency note).
//
// ROLE LAYOUTS (2026-09-19, manager console added in the manager-console
// redesign PR): the page only fetches data and picks a view — each role has
// its own layout under components/account/ (DinerAccountView,
// OwnerAccountView, ManagerAccountView, AdminAccountView), sharing the
// summary/details/security/privacy pieces. Admin, owner, and manager views
// all render inside their own console shell (banner + left menu — see
// components/console/ConsoleShell.tsx). For an owner this page is THE
// business page (stat tiles + restaurants + profile + security + data &
// privacy): the separate owner dashboard was folded in (2026-09-19). For a
// manager this page is THE manager console (locations I manage + profile).
// /portal/dashboard now just redirects both owner and manager here. The
// server actions (app/account/actions.ts) and the role gating are
// otherwise unchanged.
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import { ApiError } from "@/lib/api/client";
import { loadOwnerRestaurants, type OwnerRestaurants } from "@/lib/owner/loadOwnerRestaurants";
import {
  loadManagedLocationStatuses,
  type ManagedLocationWithStatus,
} from "@/lib/manager/loadManagedLocationStatuses";
import {
  getCurrentUser,
  getMyDataDeletionRequests,
  getMyFollows,
  getMyManagedLocations,
} from "@/lib/api/auth";
import AdminShell from "@/components/admin/AdminShell";
import ManagerShell from "@/components/portal/ManagerShell";
import OwnerShell from "@/components/portal/OwnerShell";
import AdminAccountView from "@/components/account/AdminAccountView";
import DinerAccountView from "@/components/account/DinerAccountView";
import ManagerAccountView from "@/components/account/ManagerAccountView";
import OwnerAccountView from "@/components/account/OwnerAccountView";
import InfoPanel from "@/components/ui/InfoPanel";
import type { AuthMe } from "@/types/auth";
import type { FollowedBrand } from "@/types/follow";
import type { DataDeletionRequest } from "@/types/privacy";

export const metadata: Metadata = {
  title: "My Account",
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

  let managedLocations: ManagedLocationWithStatus[] = [];
  let managedLocationsError: string | null = null;
  if (me && me.role === "manager") {
    try {
      const page = await getMyManagedLocations({ page: 1, page_size: 50 }, session.accessToken);
      managedLocations = await loadManagedLocationStatuses(page.results);
    } catch (error) {
      managedLocationsError =
        error instanceof ApiError
          ? error.message
          : "Could not load your assigned locations. Please try again.";
    }
  }

  // Owners: the restaurants list rendered on this page (never throws; a
  // failure comes back as `loadError` and the section shows it).
  let ownerRestaurants: OwnerRestaurants | null = null;
  if (me && me.role === "owner") {
    ownerRestaurants = await loadOwnerRestaurants(session.accessToken);
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

  // Admins get the admin console frame (banner + left menu, Profile active)
  // -- the same AdminShell app/admin/layout.tsx uses for the other sections.
  if (me?.role === "admin") {
    return (
      <AdminShell me={me} profile>
        <AdminAccountView me={me} latestDeletionRequest={latestDeletionRequest} />
      </AdminShell>
    );
  }

  // Owners get the business console frame (banner + left menu, "Business
  // account" active) -- the same OwnerShell /portal/brands/* uses.
  if (me?.role === "owner") {
    return (
      <OwnerShell me={me} profile>
        <OwnerAccountView
          me={me}
          brands={ownerRestaurants?.brands ?? []}
          restaurantsError={ownerRestaurants?.loadError ?? null}
          latestDeletionRequest={latestDeletionRequest}
        />
      </OwnerShell>
    );
  }

  // Managers get the manager console frame (banner + left menu, "My
  // locations" / "Profile") -- the same ConsoleShell the owner and admin
  // consoles use, via components/portal/ManagerShell.tsx.
  if (me?.role === "manager") {
    return (
      <ManagerShell me={me} profile>
        <ManagerAccountView
          me={me}
          locations={managedLocations}
          locationsError={managedLocationsError}
          latestDeletionRequest={latestDeletionRequest}
        />
      </ManagerShell>
    );
  }

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {meError && (
          <>
            <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
              My Account
            </h1>
            <div className="mt-6">
              <InfoPanel title="Couldn't load your account" body={meError} />
            </div>
          </>
        )}

        {me?.role === "registered_user" && (
          <DinerAccountView
            me={me}
            follows={follows}
            followsError={followsError}
            latestDeletionRequest={latestDeletionRequest}
          />
        )}
      </div>
    </main>
  );
}
