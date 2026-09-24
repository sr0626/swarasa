// Unit tests for the restaurant-page JSON-LD builders.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import type { LocationDetail } from "../../types/location.ts";
import type { BrandLocationCard } from "../../types/restaurant.ts";
import {
  buildLandingSchema,
  buildLocationRestaurantSchema,
  buildOpeningHoursSchema,
} from "./jsonld.ts";

const brand = {
  name: "Namaste Grill",
  cuisine_tags: [{ name: "north_indian", display_name: "North Indian", category: "regional" as const }],
};

// Only the fields the builders read.
function location(overrides: Record<string, unknown> = {}): LocationDetail {
  return {
    address_line1: "2234 W Walnut Hill Ln",
    city: "Irving",
    state: "TX",
    postal_code: "75038",
    phone: "+19725550142",
    latitude: 32.85,
    longitude: -96.95,
    cover_photo_url: "https://cdn.example.com/c.jpg",
    hours: [
      { day_of_week: 0, open_time: "11:00:00", close_time: "22:00:00", is_closed: false },
      { day_of_week: 1, is_closed: true },
      { day_of_week: 2, is_closed: null },
    ],
    ...overrides,
  } as unknown as LocationDetail;
}

test("opening hours: only known open days, HH:MM", () => {
  assert.deepEqual(buildOpeningHoursSchema(location().hours), ["Mo 11:00-22:00"]);
});

test("location Restaurant carries THAT location's address, phone, hours, geo and url", () => {
  const schema = buildLocationRestaurantSchema({
    restaurant: brand,
    location: location(),
    hasMenu: { "@type": "Menu" },
    url: "https://www.swarasa.com/restaurant/namaste-grill/irving",
  });
  assert.equal(schema["@type"], "Restaurant");
  assert.equal(schema.url, "https://www.swarasa.com/restaurant/namaste-grill/irving");
  assert.deepEqual(schema.servesCuisine, ["North Indian"]);
  assert.equal((schema as { telephone?: string }).telephone, "+19725550142");
  assert.equal(
    (schema as { address?: { addressLocality: string } }).address?.addressLocality,
    "Irving"
  );
  assert.deepEqual((schema as { openingHours?: string[] }).openingHours, ["Mo 11:00-22:00"]);
  assert.equal(
    (schema as { geo?: { latitude: number } }).geo?.latitude,
    32.85
  );
  assert.deepEqual(schema.hasMenu, { "@type": "Menu" });
});

test("a brand with no location still yields valid markup without an address", () => {
  const schema = buildLocationRestaurantSchema({ restaurant: brand, location: null, hasMenu: null });
  assert.equal("address" in schema, false);
  assert.equal("hasMenu" in schema, false);
  assert.equal("url" in schema, false);
});

test("landing page is an ItemList of Restaurants, one per location, each with its own url", () => {
  const cards = [
    { slug: "irving", city: "Irving", location_name: null, address_line1: "1 A St", state: "TX", postal_code: "75038", phone: "+19725550100" },
    { slug: "plano", city: "Plano", location_name: "Legacy", address_line1: "2 B St", state: "TX", postal_code: "75024", phone: null },
  ] as unknown as BrandLocationCard[];
  const schema = buildLandingSchema({
    restaurant: brand,
    locations: cards,
    locationUrl: (slug) => `https://www.swarasa.com/restaurant/namaste-grill/${slug}`,
  });
  assert.equal(schema["@type"], "ItemList");
  assert.equal(schema.numberOfItems, 2);
  const [first, second] = schema.itemListElement;
  assert.equal(first?.position, 1);
  assert.equal(first?.item.url, "https://www.swarasa.com/restaurant/namaste-grill/irving");
  assert.equal(first?.item.name, "Namaste Grill — Irving");
  assert.equal(second?.item.name, "Namaste Grill — Legacy");
  assert.equal(second?.item.address.addressLocality, "Plano");
});
