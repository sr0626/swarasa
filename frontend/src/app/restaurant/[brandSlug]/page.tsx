// `/restaurant/{brandSlug}` — the brand URL. SSR + schema.org JSON-LD +
// canonical, per frontend/CLAUDE.md's "SEO Requirements". What it renders
// depends on how many ACTIVE locations the brand has (lib/restaurant/pageMode.ts):
//
//   0 locations -> a brand-only page (name, description, claim CTA)
//   1 location  -> THAT location's full profile, right here at the short brand
//                  URL (canonical = this URL). The long location URL
//                  /restaurant/{brand}/{location} also works and canonicalises here.
//   2+          -> a brand LANDING page: brand header + one card per location
//                  (each links to /restaurant/{brand}/{location})
//
// So every old shared link to /restaurant/{brandSlug} keeps working — even
// once a second location is added (the URL then becomes the landing page).
// Unknown / soft-deleted brand -> 404.
//
// Data: ONE round trip for the brand + its active location cards
// (`GET /restaurants/by-slug/{brand}`), plus the sole location's full detail
// (`GET /locations/{id}`, with the viewer's token so deal content is gated
// correctly) in the single-location case.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { getLocationById } from "@/lib/api/locations";
import { getRestaurantPublicBySlug } from "@/lib/api/restaurants";
import { getServerSession } from "@/lib/auth/session";
import { getViewerFollowState } from "@/lib/follow/viewerFollowState";
import { buildMenuSchema, jsonLdString } from "@/lib/menu/jsonld";
import { buildLandingSchema, buildLocationRestaurantSchema } from "@/lib/restaurant/jsonld";
import { decideBrandPage } from "@/lib/restaurant/pageMode";
import { canEditListing, loadMenuSafely } from "@/lib/restaurant/profileData";
import { brandHref, locationHref } from "@/lib/restaurant/urls";
import { SITE_URL } from "@/lib/site";
import BrandLanding from "@/components/restaurant/BrandLanding";
import LocationProfile from "@/components/restaurant/LocationProfile";
import type { RestaurantPublic } from "@/types/restaurant";

interface BrandPageProps {
  params: { brandSlug: string };
}

async function loadBrand(brandSlug: string): Promise<RestaurantPublic | null> {
  try {
    return await getRestaurantPublicBySlug(brandSlug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const restaurant = await loadBrand(params.brandSlug);
  if (!restaurant) return { title: "Restaurant Not Found" };

  const mode = decideBrandPage(restaurant.locations);
  // Title/description name the city only when the page IS one location.
  const single = mode.kind === "single" ? mode.location : null;
  const cityState = single ? ` in ${single.city}, ${single.state}` : "";
  const title =
    mode.kind === "landing"
      ? `${restaurant.name} — ${restaurant.locations.length} Desi Restaurant locations`
      : `${restaurant.name} — Desi Restaurant${cityState}`;

  return {
    title,
    description: restaurant.description
      ? restaurant.description.slice(0, 150)
      : `${title} on Swarasa.`,
    alternates: { canonical: brandHref(restaurant.slug) },
  };
}

export default async function BrandPage({ params }: BrandPageProps) {
  const session = await getServerSession();
  const restaurant = await loadBrand(params.brandSlug);
  if (!restaurant) notFound();

  const currentPath = brandHref(restaurant.slug);
  const followState = await getViewerFollowState(session);
  const mode = decideBrandPage(restaurant.locations);

  if (mode.kind === "landing") {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              buildLandingSchema({
                restaurant,
                locations: mode.locations,
                locationUrl: (locationSlug) =>
                  `${SITE_URL}${locationHref(restaurant.slug, locationSlug)}`,
              })
            ),
          }}
        />
        <BrandLanding
          restaurant={restaurant}
          locations={mode.locations}
          session={session}
          followState={followState}
          currentPath={currentPath}
        />
      </>
    );
  }

  // 0 or 1 active location: the brand URL IS the (only) location's profile.
  const location =
    mode.kind === "single"
      ? await getLocationById(mode.location.location_id, session?.accessToken)
      : null;
  const [canEdit, menu] = await Promise.all([
    canEditListing(location, session),
    loadMenuSafely(location, session?.accessToken),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // `jsonLdString` (not bare JSON.stringify): owner-authored menu text
          // is in this payload, so `<` is \u-escaped and a stray `</script>` in
          // a dish name can't break out of the tag.
          __html: jsonLdString(
            buildLocationRestaurantSchema({
              restaurant,
              location,
              hasMenu: buildMenuSchema(menu) ?? null,
              url: `${SITE_URL}${currentPath}`,
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
      />
    </>
  );
}
