// `/restaurant/{brandSlug}/{locationSlug}` — one location's own public profile
// page (hours, deals, menu, address and photos differ per branch). SSR +
// schema.org JSON-LD (a `Restaurant` with THIS location's address, phone and
// hours) + canonical.
//
// CANONICAL: for a brand with several active locations this URL is its own
// canonical. For a brand with exactly ONE active location the page ALSO lives
// at the short brand URL (/restaurant/{brand}), which is the canonical — so
// this long URL keeps working (no broken links) without duplicating content
// (lib/restaurant/urls.ts `canonicalPath`).
//
// Data: ONE round trip (`GET /restaurants/by-slug/{brand}/locations/{location}`)
// returns the brand and the location's full detail, with the same visibility and
// deal-content gating as `GET /locations/{id}`: unknown or hidden -> 404 (an
// owner/admin/assigned manager may still preview their own hidden location when
// signed in), soft-deleted brand -> 404. The viewer's token is passed so a
// signed-in caller's deal-content access is reflected; it never widens who can
// see a hidden location beyond what the backend allows.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { getLocationPageBySlugs } from "@/lib/api/restaurants";
import { getServerSession } from "@/lib/auth/session";
import { getViewerFollowState } from "@/lib/follow/viewerFollowState";
import { buildMenuSchema, jsonLdString } from "@/lib/menu/jsonld";
import { buildLocationRestaurantSchema } from "@/lib/restaurant/jsonld";
import {
  canEditListing,
  loadMenuSafely,
  pageDescription,
  pageTitle,
} from "@/lib/restaurant/profileData";
import { canonicalPath, locationHref } from "@/lib/restaurant/urls";
import { SITE_URL } from "@/lib/site";
import LocationProfile from "@/components/restaurant/LocationProfile";
import type { LocationPage } from "@/types/restaurant";

interface LocationPageProps {
  params: { brandSlug: string; locationSlug: string };
}

async function loadPage(
  brandSlug: string,
  locationSlug: string,
  accessToken?: string
): Promise<LocationPage | null> {
  try {
    return await getLocationPageBySlugs(brandSlug, locationSlug, accessToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function canonicalFor(page: LocationPage): string {
  return canonicalPath({
    brandSlug: page.restaurant.slug,
    locationSlug: page.location.slug,
    activeLocationCount: page.restaurant.location_count,
    isActive: page.location.status === "active",
  });
}

export async function generateMetadata({ params }: LocationPageProps): Promise<Metadata> {
  const page = await loadPage(params.brandSlug, params.locationSlug);
  if (!page) return { title: "Restaurant Not Found" };
  const { restaurant, location } = page;

  return {
    title: pageTitle(restaurant.name, location),
    description: pageDescription(restaurant.name, restaurant.description, location),
    alternates: { canonical: canonicalFor(page) },
  };
}

export default async function LocationProfilePage({ params }: LocationPageProps) {
  const session = await getServerSession();
  const page = await loadPage(params.brandSlug, params.locationSlug, session?.accessToken);
  if (!page) notFound();
  const { restaurant, location } = page;

  const [canEdit, menu, followState] = await Promise.all([
    canEditListing(location, session),
    loadMenuSafely(location, session?.accessToken),
    getViewerFollowState(session),
  ]);

  // The URL being rendered (sign-in return path), and the canonical one (JSON-LD `url`).
  const currentPath = locationHref(restaurant.slug, location.slug);
  const isMultiLocation = restaurant.location_count > 1;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // `jsonLdString`: owner-authored menu text is in this payload (see brand page).
          __html: jsonLdString(
            buildLocationRestaurantSchema({
              restaurant,
              location,
              hasMenu: buildMenuSchema(menu) ?? null,
              url: `${SITE_URL}${canonicalFor(page)}`,
            })
          ),
        }}
      />
      <LocationProfile
        restaurant={restaurant}
        location={location}
        menu={menu}
        session={session}
        canEdit={canEdit}
        followState={followState}
        currentPath={currentPath}
        // A brand name alone doesn't say which branch this is once there are several.
        branchLabel={
          isMultiLocation
            ? location.location_name?.trim() || `${location.city}, ${location.state}`
            : null
        }
        showAllLocationsLink={isMultiLocation}
      />
    </>
  );
}
