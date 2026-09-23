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
import Link from "next/link";
import type { SearchResultItem } from "@/types/search";
import { formatPhone } from "@/lib/formatPhone";
import DealBadge from "@/components/ui/DealBadge";
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
}

export default function RestaurantCard({
  item,
  showFollowButton = false,
  isRegisteredUser = false,
  isFollowed = false,
  currentPath = "/search",
}: RestaurantCardProps) {
  const { nearest_location } = item;
  const visibleTags = item.cuisine_tags.slice(0, 3);
  const coverPhoto = item.cover_photo_thumbnail_url ?? item.cover_photo_url;
  const fullAddress = `${nearest_location.address_line1}, ${nearest_location.city}, ${nearest_location.state} ${nearest_location.postal_code}`;
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
    <div className="group relative flex flex-col overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card transition hover:shadow-brand-card-hover">
      <Link href={`/restaurant/${item.slug}`} className="flex flex-col">
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

        <div className="flex flex-col gap-2 p-4 pb-0">
          <h3 className="font-display text-lg font-semibold text-brand-ink">
            {item.name}
          </h3>

          {visibleTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => (
                <span
                  key={tag.name}
                  className="rounded-brand-pill bg-brand-chip px-2 py-0.5 text-xs font-medium text-brand-chip-ink"
                >
                  {tag.display_name}
                </span>
              ))}
            </div>
          )}

          {item.location_count_nearby > 1 && (
            <p className="text-xs text-brand-ink-subtle">
              {item.location_count_nearby} locations nearby
            </p>
          )}
        </div>
      </Link>

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

      <div className="flex flex-1 flex-col gap-2 p-4 pt-2">
        <a
          href={googleMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex items-start gap-1 text-sm text-brand-ink-subtle hover:text-brand-ink hover:underline"
        >
          <LocationPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {fullAddress}
            {nearest_location.distance_mi !== null && ` · ${nearest_location.distance_mi.toFixed(1)} mi`}
          </span>
        </a>

        {nearest_location.phone && (
          <a
            href={`tel:${nearest_location.phone}`}
            className="flex items-center gap-1 text-sm text-brand-ink-subtle hover:text-brand-ink hover:underline"
          >
            <PhoneIcon className="h-4 w-4 shrink-0" />
            <span>{formatPhone(nearest_location.phone)}</span>
          </a>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <OpenStatusBadge
            isOpenNow={nearest_location.is_open_now}
            isClosedToday={nearest_location.is_closed}
            openTime={nearest_location.open_time}
            closeTime={nearest_location.close_time}
          />
          {nearest_location.has_deal_today && <DealBadge />}
          {!item.is_claimed && (
            <span className="ml-auto text-xs font-medium text-brand-ink-subtle">
              Unclaimed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
