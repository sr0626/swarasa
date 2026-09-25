// Restaurant card for the homepage's "Popular near you" grid.
//
// NOTE (flagged in final report): the approved mockup calls for a star
// rating on each card, but neither `SearchResultItem` (docs/API_CONTRACTS.md
// "GET /search") nor `docs/DATA_MODEL.md` has a rating/review field in
// Phase 1 — there is no reviews feature yet. Showing a star score here
// would mean fabricating data, which the task explicitly rules out, so the
// numeric rating is omitted. The star glyph the design calls for is still
// built (`StarIcon`) and used on the "Featured" ribbon instead, so the
// icon requirement is met without inventing a number.
//
// SHARED TILE: used by the homepage's "Popular near you", the search results
// and the account page's "Restaurants you follow" (FollowedRestaurantsGrid) —
// one tile, never a fork. `item` is a `RestaurantCardItem`: a followed brand
// whose locations are all inactive has `nearest_location: null`, and the
// address / hours / deal badge / Featured ribbon rows are then simply omitted.
// `distance_mi` is null on the favourites grid (no viewer position), in which
// case the address line shows no distance.
//
// UNIFORM, COMPACT TILE: every card is the same height whatever labels it
// carries. The body is stacked TIGHT from the top — name, cuisines (only when
// present), address, then the hours pill directly under the address — and the
// card has a shared min-height sized for the maximum bounded content, so ANY
// slack falls at the very bottom of the tile, never between the address and the
// pill and never between text lines. The layout is identical at every width (no
// breakpoint-specific rearrangement). Everything is bounded (name, cuisines and
// address each 1 line with ellipsis; full text in `title`) so long text can
// never grow a tile past the shared height.
//   - Cover (h-40): the "Deal(s) available today" badge top-left (solid green,
//     a plain non-link overlay for every viewer — the whole tile is the link;
//     signed-out visitors meet the sign-in prompt on the restaurant page),
//     follow heart top-right, Featured ribbon bottom-left, and an
//     "Unclaimed" / "N locations" note chip bottom-right.
//   - Body: name (1 line, ellipsis, full name in `title`), cuisines as one
//     muted line (rendered only when present, so its absence leaves no hole),
//     address + distance (1 line), then the hours pill row right under it.
//     The phone number lives on the detail page, not the tile.
import type { RestaurantCardItem } from "@/types/search";
import type { ActivitySource } from "@/types/userActivity";
import TrackedTileLink from "@/components/listing/TrackedTileLink";
import DealBadge from "@/components/ui/DealBadge";
import DefaultRestaurantImage from "@/components/ui/DefaultRestaurantImage";
import FollowButton from "@/components/ui/FollowButton";
import { LocationPinIcon, StarIcon } from "@/components/ui/icons";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import { cardSideNote, formatFullAddress, googleMapsSearchUrl } from "@/lib/listing/cardText";
import { brandHref, locationHref } from "@/lib/restaurant/urls";

interface RestaurantCardProps {
  item: RestaurantCardItem;
  /** See lib/follow/viewerFollowState.ts. `false` for a signed-in
   * owner/manager/admin — root CLAUDE.md's permission model has no follow
   * use case for those roles, so the icon is omitted entirely rather than
   * shown disabled. Defaults to `false` (no icon) so a caller that forgets
   * to pass viewer state fails closed, never shows a follow icon to a role
   * that shouldn't have one. */
  showFollowButton?: boolean;
  /** Whether the viewer is a signed-in `registered_user` (toggle) as
   * opposed to signed out (sign-in redirect) — only consulted when
   * `showFollowButton` is true. */
  isRegisteredUser?: boolean;
  /** Whether the current viewer already follows this brand, for the icon's
   * initial state. Only meaningful when `isRegisteredUser`. */
  isFollowed?: boolean;
  /** Where this card is rendered (e.g. "/" for the homepage, "/search?...")
   * — passed straight through to FollowButton as its sign-in return path.
   * Required whenever `showFollowButton` is true. */
  currentPath?: string;
  /** Which surface renders this card. When set AND the viewer is a signed-in
   * registered user (`isRegisteredUser`), clicking the card is recorded in
   * their activity history (lib/activity/tileClick.ts). Never tracks anyone
   * else. */
  clickSource?: ActivitySource;
}

export default function RestaurantCard({
  item,
  showFollowButton = false,
  isRegisteredUser = false,
  isFollowed = false,
  currentPath = "/search",
  clickSource,
}: RestaurantCardProps) {
  const { nearest_location } = item;
  const cuisineLine = item.cuisine_tags
    .slice(0, 3)
    .map((tag) => tag.display_name)
    .join(" \u00b7 ");
  const coverPhoto = item.cover_photo_thumbnail_url ?? item.cover_photo_url;
  const fullAddress = nearest_location ? formatFullAddress(nearest_location) : null;
  // Bottom-right cover chip: one short note, Unclaimed taking precedence
  // over the locations count.
  const sideNote = cardSideNote(item.is_claimed, item.location_count_nearby);

  return (
    // A plain <div>, not a <Link> — the address line below opens Google
    // Maps in its own <a>, and an <a> can't nest inside another <a>
    // (invalid HTML; browsers handle it inconsistently). The Link below
    // covers the rest of the card (image, name, tags); border/shadow live
    // here so the whole card still looks and hover-highlights as one unit.
    // `relative` so the follow icon below (a sibling of the Link, for the
    // same nested-<a> reason — its signed-out state is itself a Link) can
    // sit absolutely positioned over the image's top-right corner without
    // living inside the card's own Link.
    <div className="group relative flex h-full min-h-[18.8rem] flex-col overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card transition hover:shadow-brand-card-hover">
      <TrackedTileLink
        // The tile represents ONE location, so it links to that location's own page
        // (a followed brand with no active location falls back to the brand URL).
        href={
          nearest_location
            ? locationHref(item.slug, nearest_location.slug)
            : brandHref(item.slug)
        }
        className="flex flex-col"
        track={
          isRegisteredUser && clickSource
            ? {
                brand_id: item.brand_id,
                location_id: nearest_location?.location_id ?? null,
                source: clickSource,
              }
            : undefined
        }
      >
        <div className="relative h-40 w-full shrink-0 overflow-hidden bg-brand-warm-gradient">
          {coverPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote
            // CloudFront URL, no next/image domain config for this host yet
            // (same as RestaurantHero.tsx, the detail page's equivalent).
            <img
              src={coverPhoto}
              alt={`${item.name} cover photo`}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <DefaultRestaurantImage />
          )}
          {nearest_location?.is_paid && (
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-brand-pill bg-brand-ink/85 px-2.5 py-1 text-xs font-semibold text-brand-bg">
              <StarIcon className="h-3 w-3" />
              Featured
            </span>
          )}
          {nearest_location?.has_deal_today && (
            // Top-left, a plain non-link badge for EVERY viewer: the whole tile
            // is already the link (signed-out visitors get the sign-in prompt
            // on the restaurant page's deals banner).
            <DealBadge variant="overlay" className="absolute left-3 top-3" />
          )}
          {sideNote && (
            <span className="absolute bottom-3 right-3 max-w-[40%] truncate rounded-brand-pill bg-brand-ink/85 px-2.5 py-1 text-xs font-semibold text-brand-bg">
              {sideNote}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5 px-4 pt-4">
          <h3
            title={item.name}
            className="truncate font-display text-lg font-semibold leading-6 text-brand-ink"
          >
            {item.name}
          </h3>
          {cuisineLine && (
            <p className="truncate text-xs font-medium leading-4 text-brand-ink-subtle">
              {cuisineLine}
            </p>
          )}
        </div>
      </TrackedTileLink>

      {showFollowButton && (
        <FollowButton
          brandId={item.brand_id}
          restaurantName={item.name}
          isRegisteredUser={isRegisteredUser}
          initialFollowed={isFollowed}
          currentPath={currentPath}
          wrapperClassName="absolute right-3 top-3 z-10"
        />
      )}

      {nearest_location && fullAddress && (
        <div className="px-4 pt-2">
          <a
            href={googleMapsSearchUrl(fullAddress)}
            target="_blank"
            rel="noopener noreferrer"
            // py-3 + -my-3: a 44px-tall tap area around the 20px text line with NO change
            // to the tile's layout height (tiles stay equal height, PR #214).
            className="-my-3 flex items-start gap-1 py-3 text-sm leading-5 text-brand-ink-subtle hover:text-brand-ink hover:underline"
          >
            <LocationPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate" title={fullAddress}>
              {fullAddress}
              {nearest_location.distance_mi !== null &&
                ` \u00b7 ${nearest_location.distance_mi.toFixed(1)} mi`}
            </span>
          </a>
        </div>
      )}

      {/* Hours pill: directly under the address (normal small gap), NOT pinned
          to the bottom — any slack in the card (which has a shared min-height)
          falls below it. Fixed row height so the pill row is identical on every
          tile, whether or not hours are known. */}
      {nearest_location && (
        <div className="flex h-7 items-center px-4 pb-3 pt-2 box-content">
          <OpenStatusBadge
            isOpenNow={nearest_location.is_open_now}
            isClosedToday={nearest_location.is_closed}
            openTime={nearest_location.open_time}
            closeTime={nearest_location.close_time}
          />
        </div>
      )}
    </div>
  );
}
