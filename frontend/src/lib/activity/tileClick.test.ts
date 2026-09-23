// Unit tests for restaurant-tile click tracking helpers. Run with Node's
// built-in runner:
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { parseTileClickBody, sendTileClick, TILE_CLICK_ENDPOINT } from "./tileClick.ts";

test("parseTileClickBody accepts a full and a brand-level body", () => {
  assert.deepEqual(
    parseTileClickBody({ brand_id: 5, location_id: 9, source: "search_results" }),
    { brand_id: 5, location_id: 9, source: "search_results" }
  );
  assert.deepEqual(parseTileClickBody({ brand_id: 5, source: "favourites" }), {
    brand_id: 5,
    location_id: null,
    source: "favourites",
  });
});

test("parseTileClickBody drops unknown fields", () => {
  const parsed = parseTileClickBody({
    brand_id: 5,
    location_id: null,
    source: "homepage",
    email: "leak@example.com",
  });
  assert.deepEqual(parsed, { brand_id: 5, location_id: null, source: "homepage" });
});

test("parseTileClickBody rejects malformed bodies", () => {
  const bad: unknown[] = [
    null,
    "string",
    [],
    {},
    { brand_id: 0, source: "homepage" },
    { brand_id: -1, source: "homepage" },
    { brand_id: 1.5, source: "homepage" },
    { brand_id: "5", source: "homepage" },
    { brand_id: 5, location_id: "9", source: "homepage" },
    { brand_id: 5, location_id: 0, source: "homepage" },
    { brand_id: 5, source: "somewhere_else" },
    { brand_id: 5 },
  ];
  for (const body of bad) {
    assert.equal(parseTileClickBody(body), null, JSON.stringify(body));
  }
});

const INPUT = { brand_id: 5, location_id: 9, source: "search_results" } as const;

test("sendTileClick prefers sendBeacon and does not also fetch", () => {
  const beacons: Array<{ url: string; data: Blob }> = [];
  let fetched = 0;
  sendTileClick(INPUT, {
    sendBeacon: (url, data) => {
      beacons.push({ url, data });
      return true;
    },
    fetchKeepalive: async () => {
      fetched += 1;
    },
  });
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].url, TILE_CLICK_ENDPOINT);
  assert.equal(beacons[0].data.type, "application/json");
  assert.equal(fetched, 0);
});

test("sendTileClick falls back to keepalive fetch when the beacon refuses", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  sendTileClick(INPUT, {
    sendBeacon: () => false,
    fetchKeepalive: async (url, init) => {
      calls.push({ url, init });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TILE_CLICK_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.keepalive, true);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), INPUT);
});

test("sendTileClick never throws, even when every transport blows up", async () => {
  assert.doesNotThrow(() =>
    sendTileClick(INPUT, {
      sendBeacon: () => {
        throw new Error("beacon exploded");
      },
    })
  );
  assert.doesNotThrow(() =>
    sendTileClick(INPUT, {
      fetchKeepalive: () => Promise.reject(new Error("network down")),
    })
  );
  // Let the swallowed rejection settle without an unhandled-rejection crash.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.doesNotThrow(() => sendTileClick(INPUT, {}));
});
