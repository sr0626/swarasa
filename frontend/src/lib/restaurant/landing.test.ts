// Unit tests for the landing-page tile mapping.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import type { BrandLocationCard } from "../../types/restaurant.ts";
import { cardItemForLocation, landingTitle } from "./landing.ts";

const restaurant = {
  id: 9,
  name: "Namaste Grill",
  slug: "namaste-grill",
  is_claimed: true,
  cuisine_tags: [],
};

const card = {
  location_id: 4,
  slug: "irving",
  city: "Irving",
  location_name: null,
  cover_photo_url: "https://cdn.example.com/full.jpg",
  cover_photo_thumbnail_url: "https://cdn.example.com/thumb.jpg",
} as unknown as BrandLocationCard;

test("title is the brand plus the location label, or its city", () => {
  assert.equal(landingTitle("Namaste Grill", card), "Namaste Grill — Irving");
  assert.equal(
    landingTitle("Namaste Grill", { city: "Irving", location_name: " Legacy West " }),
    "Namaste Grill — Legacy West"
  );
});

test("tile item: brand slug for the link base, the card as nearest_location, no locations chip", () => {
  const item = cardItemForLocation(restaurant, card);
  assert.equal(item.slug, "namaste-grill");
  assert.equal(item.brand_id, 9);
  assert.equal(item.nearest_location, card);
  assert.equal(item.nearest_location?.slug, "irving");
  assert.equal(item.location_count_nearby, 1);
  assert.equal(item.cover_photo_thumbnail_url, "https://cdn.example.com/thumb.jpg");
});
