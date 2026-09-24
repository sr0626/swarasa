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
// UNIFORM TILE (2026-09-24, user feedback: tiles differed in height/white
// space depending on which labels they carried): every card has the exact
// same height and layout regardless of hours/deal/tags/phone/claim state.
//   - Cover (h-40): Featured ribbon top-left, follow heart top-right, and the
//     "Deal(s) available today" badge bottom-left as an OVERLAY - it consumes
//     no body height. Signed-out it is a real sign-in <Link> that is a
//     SIBLING of the tile link (an <a> can't nest in an <a>), positioned over
//     the cover.
//   - Body rows all have fixed heights (name 2 lines, tags 1 line, address 2
//     lines, phone 1 line, meta row) and clamp overflow, so a missing or long
//     value never moves anything. The meta row (hours pill, plus Unclaimed /
//     "N locations" on the right) is one fixed-height row.
import type { SearchResultItem } from "@/types/search";
import type { ActivitySource } from "@/types/userActivity";
import TrackedTileLink from "@/components/listing/TrackedTileLink";
import { formatPhone } from "@/lib/formatPhone";
import DealBadge from "@/components/ui/DealBadge";
import DealSignInLink from "@/components/ui/DealSignInLink";
import DefaultRestaurantImage from "@/components/ui/DefaultRestaurantImage";
import FollowButton from "@/components/ui/FollowButton";
import {
  LocationPinIcon,
  PhoneIcon,
  StarIcon,
} from "@/components/ui/icons";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";

interface RestaurantCardProps {
  item: SearchResultItem;
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
  // Signed out = the follow icon is shown (so the viewer isn't an owner/
  // manager/admin) but the viewer isn't a registered user. Fails closed:
  // with the default `showFollowButton=false` no sign-in CTA ever renders.
  const isSignedOut = showFollowButton && !isRegisteredUser;
  const visibleTags = item.cuisine_tags.slice(0, 3);
  const coverPhoto = item.cover_photo_thumbnail_url ?? item.cover_photo_url;
  const fullAddress = `${nearest_location.address_line1}, ${nearest_location.city}, ${nearest_location.state} ${nearest_location.postal_code}`;
  // Right-hand slot of the meta row: one short note, Unclaimed taking
  // precedence over the nearby-locations count.
  const sideNote = !item.is_claimed
    ? "Unclaimed"
    : item.location_count_nearby > 1
      ? `${item.location_count_nearby} locations`
      : null;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;

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
    <div className="group relative flex h-full flex-col overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card transition hover:shadow-brand-card-hover">
      <TrackedTileLink
        href={`/restaurant/${item.slug}`}
        className="flex flex-col"
        track={
          isRegisteredUser && clickSource
            ? {
                brand_id: item.brand_id,
                location_id: nearest_location.location_id,
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
          {nearest_location.is_paid && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-brand-pill bg-brand-ink/85 px-2.5 py-1 text-xs font-semibold text-brand-bg">
              <StarIcon className="h-3 w-3" />
              Featured
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 px-4 pt-4">
          <h3 className="line-clamp-2 h-12 font-display text-lg font-semibold leading-6 text-brand-ink">
            {item.name}
          </h3>

          {/* One line only: chips that don't fit wrap onto a second line
              that the fixed height clips, so no chip is ever cut in half. */}
          <div className="flex h-6 flex-wrap gap-1.5 overflow-hidden">
            {visibleTags.map((tag) => (
              <span
                key={tag.name}
                className="whitespace-nowrap rounded-brand-pill bg-brand-chip px-2 py-0.5 text-xs font-medium text-brand-chip-ink"
              >
                {tag.display_name}
              </span>
            ))}
          </div>
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

      {/* Deal badge: overlay on the cover's bottom-left (see file header).
          A sibling of the tile link, never a child, so the signed-out
          sign-in <Link> stays valid HTML. The wrapper is 44px tall so the
          link keeps a 44px touch target; the non-link badge variant is
          pointer-events-none so clicks fall through to the tile link. */}
      {nearest_location.has_deal_today &&
        (isSignedOut ? (
          <div className="absolute left-1 top-40 z-10 max-w-[calc(100%-0.5rem)] -translate-y-full">
            <DealSignInLink currentPath={currentPath} variant="badge" overlay />
          </div>
        ) : (
          <div className="pointer-events-none absolute left-1 top-40 z-10 flex min-h-11 max-w-[calc(100%-0.5rem)] -translate-y-full items-center px-2">
            <DealBadge variant="overlay" />
          </div>
        ))}

      <div className="flex flex-col gap-2 px-4 pb-4 pt-2">
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 items-start gap-1 text-sm leading-5 text-brand-ink-subtle hover:text-brand-ink hover:underline"
        >
          <LocationPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-2 min-w-0">
            {fullAddress}
            {nearest_location.distance_mi !== null && ` · ${nearest_location.distance_mi.toFixed(1)} mi`}
          </span>
        </a>

        {/* Always occupies one row, even with no phone, so cards without a
            number are the same height as those with one. */}
        <div className="h-5">
          {nearest_location.phone && (
            <a
              href={`tel:${nearest_location.phone}`}
              className="inline-flex items-center gap-1 text-sm leading-5 text-brand-ink-subtle hover:text-brand-ink hover:underline"
            >
              <PhoneIcon className="h-4 w-4 shrink-0" />
              <span>{formatPhone(nearest_location.phone)}</span>
            </a>
          )}
        </div>

        {/* The single fixed-height meta row. The hours pill renders nothing
            when hours are unknown, but the row's height is still reserved. */}
        <div className="flex h-7 items-center gap-2">
          <span className="shrink-0">
            <OpenStatusBadge
              isOpenNow={nearest_location.is_open_now}
              isClosedToday={nearest_location.is_closed}
              openTime={nearest_location.open_time}
              closeTime={nearest_location.close_time}
            />
          </span>
          {sideNote && (
            <span className="ml-auto min-w-0 truncate text-xs font-medium text-brand-ink-subtle">
              {sideNote}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
