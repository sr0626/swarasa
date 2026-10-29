// Unit tests for the public engagement-beacon helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  LINK_EVENTS,
  onceKey,
  parseTrackBody,
  sendTrackEvent,
  shouldCountOnce,
  TRACK_ENDPOINT,
} from "./track.ts";

test("parseTrackBody accepts a valid body and drops extra fields", () => {
  assert.deepEqual(parseTrackBody({ location_id: 7, event: "page_view", ip: "1.2.3.4", user: "x" }), {
    location_id: 7,
    event: "page_view",
  });
});

test("parseTrackBody rejects malformed bodies and unknown events", () => {
  const bad: unknown[] = [
    null,
    "x",
    [],
    {},
    { location_id: 0, event: "page_view" },
    { location_id: 1.5, event: "page_view" },
    { location_id: "7", event: "page_view" },
    { location_id: 7, event: "bogus" },
    { location_id: 7 },
  ];
  for (const body of bad) assert.equal(parseTrackBody(body), null, JSON.stringify(body));
});

test("link data-track values map to click events", () => {
  assert.equal(LINK_EVENTS.website, "website_click");
  assert.equal(LINK_EVENTS.directions, "directions_click");
  assert.equal(LINK_EVENTS.phone, "phone_click");
  assert.equal(LINK_EVENTS.nope, undefined);
});

test("sendTrackEvent prefers sendBeacon and sends only the two fields", () => {
  const calls: string[] = [];
  let fetched = false;
  sendTrackEvent(
    { location_id: 3, event: "phone_click" },
    {
      sendBeacon: (url) => {
        calls.push(url);
        return true;
      },
      fetchKeepalive: async () => {
        fetched = true;
      },
    }
  );
  assert.deepEqual(calls, [TRACK_ENDPOINT]);
  assert.equal(fetched, false);
});

test("sendTrackEvent falls back to keepalive fetch and swallows every failure", async () => {
  let init: RequestInit | undefined;
  sendTrackEvent(
    { location_id: 3, event: "deal_view" },
    {
      sendBeacon: () => false,
      fetchKeepalive: async (_url, i) => {
        init = i;
      },
    }
  );
  assert.equal(init?.keepalive, true);
  assert.equal(init?.body, JSON.stringify({ location_id: 3, event: "deal_view" }));

  assert.doesNotThrow(() =>
    sendTrackEvent(
      { location_id: 3, event: "page_view" },
      {
        sendBeacon: () => {
          throw new Error("boom");
        },
      }
    )
  );
  assert.doesNotThrow(() =>
    sendTrackEvent({ location_id: 3, event: "page_view" }, { fetchKeepalive: () => Promise.reject(new Error("x")) })
  );
});

test("shouldCountOnce counts a key once per session and fails open without storage", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const key = onceKey(5, "page_view");
  assert.equal(shouldCountOnce(storage, key), true);
  assert.equal(shouldCountOnce(storage, key), false);
  assert.equal(shouldCountOnce(storage, onceKey(6, "page_view")), true);
  assert.equal(shouldCountOnce(null, key), true);
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => undefined,
  };
  assert.equal(shouldCountOnce(throwing, key), true);
});
