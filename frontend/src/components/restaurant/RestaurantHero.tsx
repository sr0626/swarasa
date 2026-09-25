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
import { HeartIcon } from "@/components/ui/icons";
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
  /**
   * True when the current viewer can edit this listing (owner of the
   * brand, an assigned manager, or admin — `canEditListing` in
   * lib/restaurant/profileData.ts, the same gate that shows
   * `EditListingBar`). `showFollowButton` is always false for this viewer
   * (root CLAUDE.md's permission model has no follow use case for
   * owner/manager/admin — see `showFollowButton`'s own doc comment above),
   * so instead of nothing they get a non-interactive preview of the follow
   * icon in its signed-in-diner appearance, labeled as such: an annotation
   * showing them what a real diner sees, not a working control (the
   * backend restricts follow to `registered_user` regardless of anything
   * this page renders).
   */
  ownerPreview: boolean;
  /** Muted line under the name naming the branch (e.g. "Irving, TX") — set on a location page
   * of a MULTI-location brand, where the brand name alone doesn't say which branch this is. */
  subtitle?: string | null;
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
  ownerPreview,
  subtitle = null,
}: RestaurantHeroProps) {
  const photos = collectPhotos(restaurant.name, location);
  // Tags are per location: show THIS branch's own tags (the brand union only when the
  // page has no location at all).
  const cuisineTags = (location ? location.cuisine_tags : restaurant.cuisine_tags) ?? [];

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
        {/* flex-wrap: the owner-preview marker below is ~245px wide, so on a
            375px phone it drops to its own line under the name instead of
            squeezing the name into 3 lines and overflowing the page. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <h1 className="min-w-0 break-words font-display text-3xl font-bold text-brand-ink sm:text-4xl">
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
          {/* Owner/manager/admin preview of the follow icon -- see
              `ownerPreview` doc comment above. Mutually exclusive with
              `showFollowButton` in practice (a viewer who can edit this
              listing is never a registered_user or signed-out visitor), but
              guarded explicitly anyway so this never doubles up if that
              ever changes. Not a <button>: no onClick, no aria-pressed, and
              `aria-hidden` on the icon itself -- the adjacent label text is
              the only thing a screen reader announces here, so it reads as
              descriptive copy, never as a broken control. */}
          {!showFollowButton && ownerPreview && (
            <span className="flex max-w-full items-center gap-2 sm:mt-1">
              <span
                aria-hidden="true"
                title="Diners see a follow button here"
                className="flex h-11 w-11 shrink-0 cursor-default items-center justify-center rounded-full bg-white/90 text-brand-ink-subtle opacity-70 shadow-brand-card backdrop-blur-sm"
              >
                <HeartIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-medium text-brand-chip-ink">
                Diners see a follow button here
              </span>
            </span>
          )}
        </div>

        {subtitle && <p className="-mt-1 text-base text-brand-ink-muted">{subtitle}</p>}

        {cuisineTags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {groupCuisineTagsByCategory(cuisineTags).map((group) => (
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
