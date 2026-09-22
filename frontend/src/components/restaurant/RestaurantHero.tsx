// Hero for the public restaurant detail page: a photo carousel of the
// location's cover photo + gallery (so owners can show dish photos, not
// just one banner), then the name and cuisine tags.
//
// Photo count decides the rendering:
//   0 photos -> the shared coffee-cup default image on the warm gradient
//   1 photo  -> a plain image, no controls
//   2+       -> RestaurantPhotoCarousel (client component)
// `gallery_photos` already arrives pre-truncated by the backend to the
// location's tier limit (2 free / 10 paid, docs/DECISIONS.md "Photo
// gallery") -- this only merges and renders, it does not re-implement that
// gate.
//
// The open/closed status is deliberately NOT overlaid on the photo any more:
// the sidebar info card carries it (RestaurantInfoCard), so repeating it
// here would just be noise.
import DefaultRestaurantImage from "@/components/ui/DefaultRestaurantImage";
import FollowButton from "@/components/ui/FollowButton";
import RestaurantPhotoCarousel, {
  type CarouselPhoto,
} from "@/components/restaurant/RestaurantPhotoCarousel";
import type { RestaurantBrand } from "@/types/restaurant";
import type { LocationDetail } from "@/types/location";
import type { CuisineCategory, CuisineTag } from "@/types/cuisine";

/** Short group label per `cuisine_tag.category` (backend/app/models/
 * cuisine_tag.py, frontend/src/types/cuisine.ts) -- previously all five
 * categories were dumped into one flat, unlabeled pill row with no
 * indication of what a tag meant (a regional cuisine? a dietary note? a
 * restaurant type?). Order here is also the display order: what kind of
 * place this is (regional/type) before dietary, then the softer
 * signature/dining_time descriptors. */
const CUISINE_CATEGORY_LABELS: Record<CuisineCategory, string> = {
  regional: "Cuisine",
  type: "Type",
  dietary: "Dietary",
  signature: "Known for",
  dining_time: "Good for",
};

const CUISINE_CATEGORY_ORDER: CuisineCategory[] = [
  "regional",
  "type",
  "dietary",
  "signature",
  "dining_time",
];

interface CuisineTagGroup {
  label: string;
  tags: CuisineTag[];
}

/** Groups tags by category in the fixed display order above. Any tag
 * whose category isn't one of the five known values (future taxonomy
 * addition the frontend type hasn't caught up to yet) still renders,
 * under its raw category string, rather than silently disappearing. */
function groupCuisineTagsByCategory(tags: CuisineTag[]): CuisineTagGroup[] {
  const groups: CuisineTagGroup[] = CUISINE_CATEGORY_ORDER.map((category) => ({
    label: CUISINE_CATEGORY_LABELS[category],
    tags: tags.filter((tag) => tag.category === category),
  })).filter((group) => group.tags.length > 0);

  const knownCategories = new Set<string>(CUISINE_CATEGORY_ORDER);
  const otherTags = tags.filter((tag) => !knownCategories.has(tag.category));
  const otherGroupsByCategory = new Map<string, CuisineTag[]>();
  otherTags.forEach((tag) => {
    const existing = otherGroupsByCategory.get(tag.category) ?? [];
    existing.push(tag);
    otherGroupsByCategory.set(tag.category, existing);
  });
  otherGroupsByCategory.forEach((groupTags, category) => {
    groups.push({ label: category, tags: groupTags });
  });

  return groups;
}

interface RestaurantHeroProps {
  restaurant: RestaurantBrand;
  /** Full location detail for the brand's primary location — null when the
   * brand has no locations yet (an unclaimed, address-less seed row). */
  location: LocationDetail | null;
  /** See lib/follow/viewerFollowState.ts — `false` only for a signed-in
   * owner/manager/admin (root CLAUDE.md's permission model has no follow
   * use case for those roles), so the icon is omitted entirely for them.
   * `true` for both a signed-out visitor and a signed-in registered_user —
   * `isRegisteredUser` below distinguishes those two. */
  showFollowButton: boolean;
  /** Whether the viewer is a signed-in registered_user (toggle) as opposed
   * to signed out (sign-in redirect). Only consulted when
   * `showFollowButton` is true. */
  isRegisteredUser: boolean;
  /** Whether the current viewer already follows this brand. Only
   * meaningful when `isRegisteredUser`. */
  isFollowed: boolean;
  /** This page's own path (e.g. "/restaurant/spice-garden") — the sign-in
   * return destination for a signed-out follow click. */
  currentPath: string;
}

/** Cover first, then gallery in display order; a cover that is also a
 * gallery entry (same URL) is shown once. */
function collectPhotos(name: string, location: LocationDetail | null): CarouselPhoto[] {
  if (!location) return [];
  const urls: string[] = [];
  if (location.cover_photo_url) urls.push(location.cover_photo_url);
  [...location.gallery_photos]
    .sort((a, b) => a.display_order - b.display_order)
    .forEach((photo) => {
      if (!urls.includes(photo.url)) urls.push(photo.url);
    });
  return urls.map((url, index) => ({ url, alt: `${name} photo ${index + 1}` }));
}

export default function RestaurantHero({
  restaurant,
  location,
  showFollowButton,
  isRegisteredUser,
  isFollowed,
  currentPath,
}: RestaurantHeroProps) {
  const photos = collectPhotos(restaurant.name, location);

  return (
    <section aria-label={`${restaurant.name} photos and summary`}>
      {photos.length >= 2 ? (
        <RestaurantPhotoCarousel photos={photos} label={`${restaurant.name} photos`} />
      ) : (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-brand-card border border-brand-border bg-brand-warm-gradient sm:aspect-[16/9]">
          {photos.length === 1 && photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote
            // CloudFront URL, no next/image domain config for this host yet.
            <img
              src={photos[0].url}
              alt={photos[0].alt}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <DefaultRestaurantImage />
          )}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            {restaurant.name}
          </h1>
          {showFollowButton && (
            <FollowButton
              brandId={restaurant.id}
              restaurantName={restaurant.name}
              isRegisteredUser={isRegisteredUser}
              initialFollowed={isFollowed}
              currentPath={currentPath}
              wrapperClassName="mt-1 shrink-0"
            />
          )}
        </div>

        {restaurant.cuisine_tags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {groupCuisineTagsByCategory(restaurant.cuisine_tags).map((group) => (
              <div key={group.label} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-brand-ink-muted">
                  {group.label}:
                </span>
                {group.tags.map((tag) => (
                  <span
                    key={tag.name}
                    className="rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-medium text-brand-chip-ink"
                  >
                    {tag.display_name}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
