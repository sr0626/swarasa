// Claim submission page — `/claim?brand_id={id}`, linked to from
// `ClaimCTA.tsx` on the public restaurant detail page (PR #21).
// Implements frontend/CLAUDE.md Phase 1 scope's "Claim flow UI (submit
// claim form, upload proof)" against the real `POST /claim` contract
// (docs/API_CONTRACTS.md "Claim flow (`/claim`)").
//
// Auth: "any authenticated Cognito user" per the contract — not just
// `owner`, since the claimant doesn't have the `owner` group yet at
// submit time (that's granted on approval). Gated with the existing
// `requireSession` pattern (frontend/src/lib/auth/guards.ts), which
// redirects a signed-out visitor to `/login?next=/claim?brand_id=...`;
// login / sign-up / confirm carry `next` through and return them here.
import type { Metadata } from "next";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import { getRestaurantById, getRestaurantLocations } from "@/lib/api/restaurants";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import InfoPanel from "@/components/ui/InfoPanel";
import ClaimForm from "@/components/claim/ClaimForm";

const ALL_AUTHENTICATED_ROLES = ["owner", "manager", "admin", "registered_user"] as const;

interface ClaimPageProps {
  searchParams: { brand_id?: string };
}

export const metadata: Metadata = {
  title: "Claim Your Restaurant",
};

function parseBrandId(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default async function ClaimPage({ searchParams }: ClaimPageProps) {
  // Any authenticated user may submit a claim (docs/API_CONTRACTS.md
  // "POST /claim" — "any authenticated Cognito user (the claimant)").
  const brandId = parseBrandId(searchParams.brand_id);
  // A signed-out visitor is sent to sign in (or create an account from
  // there) and returned here afterwards -- see lib/auth/safeNext.ts.
  await requireSession(
    [...ALL_AUTHENTICATED_ROLES],
    brandId === null ? "/claim" : `/claim?brand_id=${brandId}`,
  );

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {brandId === null ? (
          <InfoPanel
            title="Missing restaurant"
            body="We couldn't tell which restaurant you want to claim. Find your restaurant from search and use its 'Claim this restaurant' button."
          />
        ) : (
          <ClaimPageContent brandId={brandId} />
        )}
      </section>
    </main>
  );
}

async function ClaimPageContent({ brandId }: { brandId: number }) {
  let restaurant;
  try {
    restaurant = await getRestaurantById(brandId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <InfoPanel
          title="Restaurant not found"
          body="This listing doesn't exist or may have been removed. Try searching again."
        />
      );
    }
    throw error;
  }

  if (restaurant.is_claimed) {
    return (
      <InfoPanel
        title="Already claimed"
        body={`${restaurant.name} has already been claimed by an owner. If you believe this is a mistake, contact support.`}
      />
    );
  }

  const locationsPage = await getRestaurantLocations(brandId, { page: 1, page_size: 100 });

  return (
    <>
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-accent">
        Claim listing
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        {restaurant.name}
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Verify you own or manage this restaurant to unlock hours, photos, and
        listing management. An admin reviews every claim within 2 business
        days.
      </p>

      <div className="mt-6">
        <ClaimForm
          brandId={brandId}
          brandName={restaurant.name}
          locations={locationsPage.results}
        />
      </div>

      <p className="mt-4 text-center text-xs text-brand-ink-subtle">
        Not the right restaurant?{" "}
        <Link href="/search" className="font-semibold text-brand-ink underline">
          Search again
        </Link>
      </p>
    </>
  );
}
