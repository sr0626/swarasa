// Maps a brand's location cards to the shared tile's input
// (`RestaurantCardItem`, components/listing/RestaurantCard.tsx) for the
// multi-location landing page, so the landing page reuses the very same tile
// as search / home / favourites — one tile, never a fork.
//
// Each tile links to `/restaurant/{brand slug}/{card.slug}` (the card's own
// `nearest_location.slug`); the tile's title is "{Brand} — {label}" where
// label is the location's optional name (e.g. "Downtown") or its city, since
// all tiles share the brand name and the address is what tells them apart.
// `location_count_nearby` is 1 so the tile shows no "N locations" chip (every
// tile on this page is one of N).
import type { RestaurantCardItem } from "@/types/search";
import type { BrandLocationCard, RestaurantPublic } from "@/types/restaurant";

export function landingTitle(
  brandName: string,
  card: Pick<BrandLocationCard, "location_name" | "city">
): string {
  return `${brandName} — ${card.location_name?.trim() || card.city}`;
}

export function cardItemForLocation(
  restaurant: Pick<RestaurantPublic, "id" | "name" | "slug" | "is_claimed" | "cuisine_tags">,
  card: BrandLocationCard
): RestaurantCardItem {
  return {
    brand_id: restaurant.id,
    name: landingTitle(restaurant.name, card),
    slug: restaurant.slug,
    is_claimed: restaurant.is_claimed,
    cuisine_tags: restaurant.cuisine_tags,
    nearest_location: card,
    location_count_nearby: 1,
    cover_photo_url: card.cover_photo_url,
    cover_photo_thumbnail_url: card.cover_photo_thumbnail_url,
  };
}
