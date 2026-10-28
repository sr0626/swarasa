// Unit tests for the city landing-page pure logic (paths, SEO text, JSON-LD,
// pagination windowing).  cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResultItem } from "../../types/search.ts";
import { canonicalPath } from "../restaurant/urls.ts";
import { buildCityIndexSchema, buildCityItemListSchema } from "./jsonld.ts";
import { buildPageList, totalPages } from "./pagination.ts";
import { CITY_INDEX_PATH, cityPagePath, cityPath, parsePageParam } from "./paths.ts";
import {
  buildCityDescription,
  buildCityHeading,
  buildCityIndexDescription,
  buildCityTitle,
  cityLabel,
} from "./seo.ts";

const irving = { city: "Irving", state: "TX" };

test("paths: city index, city, and page URLs (page 1 is the bare path)", () => {
  assert.equal(CITY_INDEX_PATH, "/indian-restaurants");
  assert.equal(cityPath("irving"), "/indian-restaurants/irving");
  assert.equal(cityPagePath("irving", 1), "/indian-restaurants/irving");
  assert.equal(cityPagePath("irving", 0), "/indian-restaurants/irving");
  assert.equal(cityPagePath("irving", 3), "/indian-restaurants/irving?page=3");
});

test("parsePageParam: absent -> 1, valid ints pass, junk -> null", () => {
  assert.equal(parsePageParam(undefined), 1);
  assert.equal(parsePageParam(""), 1);
  assert.equal(parsePageParam("2"), 2);
  assert.equal(parsePageParam(["4", "9"]), 4);
  for (const bad of ["0", "-1", "abc", "1.5", "01", "9999999"]) {
    assert.equal(parsePageParam(bad), null, bad);
  }
});

test("seo: title, heading, description", () => {
  assert.equal(cityLabel(irving), "Irving, TX");
  assert.equal(cityLabel({ city: "Irving", state: "" }), "Irving");
  assert.equal(buildCityTitle(irving), "Indian Restaurants in Irving, TX");
  assert.equal(buildCityTitle(irving, 2), "Indian Restaurants in Irving, TX — Page 2");
  assert.equal(buildCityHeading(irving), "Indian Restaurants in Irving, TX");
  const d = buildCityDescription({ ...irving, count: 12 });
  assert.match(d, /12 verified Indian restaurants in Irving, TX/);
  assert.match(buildCityDescription({ ...irving, count: 1 }), /1 verified Indian restaurant in/);
  assert.notEqual(buildCityDescription({ ...irving, count: 12 }, 2), d);
  assert.match(buildCityIndexDescription(3, 40), /40 Indian restaurants across 3 cities/);
  assert.match(buildCityIndexDescription(1, 1), /1 Indian restaurant across 1 city/);
  assert.match(buildCityIndexDescription(0, 0), /Browse Indian restaurants/);
});

function item(overrides: Partial<SearchResultItem> & { locSlug?: string } = {}): SearchResultItem {
  const { locSlug = "irving", ...rest } = overrides;
  return {
    brand_id: 1,
    name: "Namaste Grill",
    slug: "namaste-grill",
    is_claimed: true,
    cuisine_tags: [{ name: "north_indian", display_name: "North Indian", category: "regional" }],
    nearest_location: {
      location_id: 10,
      slug: locSlug,
      distance_mi: null,
      address_line1: "1 Main St",
      city: "Irving",
      state: "TX",
      postal_code: "75038",
      phone: "+19725550142",
      is_verified: true,
      is_paid: false,
      is_open_now: true,
      has_deal_today: true,
    },
    location_count_nearby: 1,
    cover_photo_url: "https://cdn.example/c.jpg",
    cover_photo_thumbnail_url: null,
    ...rest,
  };
}

test("jsonld: ItemList of Restaurants with canonical URLs and global positions", () => {
  const schema = buildCityItemListSchema({
    heading: "Indian Restaurants in Irving, TX",
    siteUrl: "https://example.com",
    results: [item(), item({ slug: "multi", name: "Multi", location_count_nearby: 3, locSlug: "irving-1" })],
    page: 2,
    pageSize: 24,
    total: 30,
  });
  assert.equal(schema["@type"], "ItemList");
  assert.equal(schema.numberOfItems, 30);
  assert.deepEqual(
    schema.itemListElement.map((e) => e.position),
    [25, 26]
  );
  const [first, second] = schema.itemListElement.map((e) => e.item);
  assert.equal(first["@type"], "Restaurant");
  // single-location brand -> short brand URL; multi-location -> location URL
  assert.equal(first.url, "https://example.com/restaurant/namaste-grill");
  assert.equal(second.url, "https://example.com/restaurant/multi/irving-1");
  assert.deepEqual(first.servesCuisine, ["North Indian"]);
  assert.equal(first.address.addressLocality, "Irving");
  assert.equal(first.telephone, "+19725550142");
  assert.equal(first.image, "https://cdn.example/c.jpg");
});

test("jsonld: URL shapes stay identical to the shared helpers", () => {
  const schema = buildCityItemListSchema({
    heading: "h",
    siteUrl: "",
    results: [item(), item({ slug: "multi", location_count_nearby: 2, locSlug: "plano" })],
    page: 1,
    pageSize: 24,
    total: 2,
  });
  const [single, multi] = schema.itemListElement.map((e) => e.item.url);
  assert.equal(single, canonicalPath({ brandSlug: "namaste-grill", locationSlug: "irving", activeLocationCount: 1, isActive: true }));
  assert.equal(multi, canonicalPath({ brandSlug: "multi", locationSlug: "plano", activeLocationCount: 2, isActive: true }));
  const index = buildCityIndexSchema({
    siteUrl: "",
    cities: [{ slug: "irving", city: "Irving", state: "TX", location_count: 1 }],
  });
  assert.equal(index.itemListElement[0].url, cityPath("irving"));
});

test("jsonld: omits telephone/image when absent and never leaks deal content", () => {
  const bare = item({ cover_photo_url: null });
  bare.nearest_location.phone = null;
  const schema = buildCityItemListSchema({
    heading: "h",
    siteUrl: "https://example.com",
    results: [bare],
    page: 1,
    pageSize: 24,
    total: 1,
  });
  const entry = schema.itemListElement[0].item as Record<string, unknown>;
  assert.equal("telephone" in entry, false);
  assert.equal("image" in entry, false);
  assert.equal(JSON.stringify(schema).includes("deal"), false);
});

test("jsonld: city index ItemList", () => {
  const schema = buildCityIndexSchema({
    siteUrl: "https://example.com",
    cities: [{ slug: "irving", city: "Irving", state: "TX", location_count: 4 }],
  });
  assert.equal(schema.numberOfItems, 1);
  assert.equal(schema.itemListElement[0].url, "https://example.com/indian-restaurants/irving");
  assert.equal(schema.itemListElement[0].name, "Indian Restaurants in Irving, TX");
});

test("pagination: totalPages and the page window", () => {
  assert.equal(totalPages(0, 24), 1);
  assert.equal(totalPages(24, 24), 1);
  assert.equal(totalPages(25, 24), 2);
  assert.deepEqual(buildPageList(1, 1), [1]);
  assert.deepEqual(buildPageList(1, 3), [1, 2, 3]);
  assert.deepEqual(buildPageList(1, 10), [1, 2, null, 10]);
  assert.deepEqual(buildPageList(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(buildPageList(10, 10), [1, null, 9, 10]);
});
