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
//
// ROLE LAYOUTS (2026-09-19): the page only fetches data and picks a view —
// each role has its own layout under components/account/ (DinerAccountView,
// OwnerAccountView, ManagerAccountView, AdminAccountView), sharing the
// summary/details/security/privacy pieces. All data-fetching, the server
// actions (app/account/actions.ts) and the role gating are unchanged.
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import { ApiError } from "@/lib/api/client";
import {
  getCurrentUser,
  getMyDataDeletionRequests,
  getMyFollows,
  getMyManagedLocations,
} from "@/lib/api/auth";
import { getMyRestaurants, getRestaurantLocations } from "@/lib/api/restaurants";
import { mapWithConcurrency } from "@/lib/concurrency";
import AdminShell from "@/components/admin/AdminShell";
import AdminAccountView from "@/components/account/AdminAccountView";
import DinerAccountView from "@/components/account/DinerAccountView";
import ManagerAccountView from "@/components/account/ManagerAccountView";
import OwnerAccountView from "@/components/account/OwnerAccountView";
import type { OwnerBrandSummary } from "@/components/account/OwnerRestaurantsPanel";
import InfoPanel from "@/components/ui/InfoPanel";
import type { AuthMe } from "@/types/auth";
import type { FollowedBrand } from "@/types/follow";
import type { ManagedLocation } from "@/types/location";
import type { DataDeletionRequest } from "@/types/privacy";
import type { RestaurantBrand } from "@/types/restaurant";

// Same cap the owner dashboard uses for its per-brand locations fan-out
// (see lib/concurrency.ts and app/portal/dashboard/page.tsx).
const LOCATIONS_FETCH_CONCURRENCY = 5;

/** Public `GET /restaurants/{id}/locations` for one brand; a failure is scoped to that brand. */
async function loadOwnerBrand(brand: RestaurantBrand): Promise<OwnerBrandSummary> {
  if (brand.location_count === 0) {
    return { brand, locations: [], locationsError: null };
  }
  try {
    const page = await getRestaurantLocations(brand.id, { page: 1, page_size: 100 });
    return { brand, locations: page.results, locationsError: null };
  } catch (error) {
    return {
      brand,
      locations: [],
      locationsError:
        error instanceof ApiError
          ? error.message
          : "Could not load this restaurant's locations. Please try again.",
    };
  }
}

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

  let ownedBrands: OwnerBrandSummary[] = [];
  let ownedBrandsError: string | null = null;
  if (me && me.role === "owner") {
    try {
      const page = await getMyRestaurants({ page: 1, page_size: 50 }, session.accessToken);
      ownedBrands = await mapWithConcurrency(
        page.results,
        LOCATIONS_FETCH_CONCURRENCY,
        loadOwnerBrand
      );
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

  // Admins get the admin console frame (banner + left menu, Profile active)
  // -- the same AdminShell app/admin/layout.tsx uses for the other sections.
  if (me?.role === "admin") {
    return (
      <AdminShell me={me} profile>
        <AdminAccountView me={me} latestDeletionRequest={latestDeletionRequest} />
      </AdminShell>
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

        {me?.role === "owner" && (
          <OwnerAccountView
            me={me}
            brands={ownedBrands}
            brandsError={ownedBrandsError}
            latestDeletionRequest={latestDeletionRequest}
          />
        )}

        {me?.role === "manager" && (
          <ManagerAccountView
            me={me}
            locations={managedLocations}
            locationsError={managedLocationsError}
            latestDeletionRequest={latestDeletionRequest}
          />
        )}
      </div>
    </main>
  );
}
