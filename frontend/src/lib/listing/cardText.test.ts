// Unit tests for the shared restaurant-tile text helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { cardSideNote, formatFullAddress, googleMapsSearchUrl } from "./cardText.ts";

const ADDRESS = {
  address_line1: "123 Main St",
  city: "Irving",
  state: "TX",
  postal_code: "75038",
};

test("formatFullAddress joins line, city, state and postal code", () => {
  assert.equal(formatFullAddress(ADDRESS), "123 Main St, Irving, TX 75038");
});

test("googleMapsSearchUrl url-encodes the address as a Maps search query", () => {
  assert.equal(
    googleMapsSearchUrl(formatFullAddress(ADDRESS)),
    "https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Irving%2C%20TX%2075038"
  );
});

test("googleMapsSearchUrl escapes characters that could break out of the query", () => {
  const url = googleMapsSearchUrl("1 A&B St #2, Plano, TX 75024");
  assert.ok(url.endsWith("query=1%20A%26B%20St%20%232%2C%20Plano%2C%20TX%2075024"));
});

test("cardSideNote: Unclaimed wins over the locations count", () => {
  assert.equal(cardSideNote(false, 3), "Unclaimed");
  assert.equal(cardSideNote(false, 1), "Unclaimed");
});

test("cardSideNote: shows the count only when there are several locations", () => {
  assert.equal(cardSideNote(true, 3), "3 locations");
  assert.equal(cardSideNote(true, 2), "2 locations");
  assert.equal(cardSideNote(true, 1), null);
  assert.equal(cardSideNote(true, 0), null);
});
