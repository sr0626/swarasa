// Unit tests for the deal-alerts bell's pure view logic.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  badgeText,
  bellLabel,
  markAllReadLocally,
  markReadLocally,
  notificationHeadline,
  notificationHref,
  shouldInterceptClick,
  type BellState,
  type ClickLike,
} from "./view.ts";
import { locationDealsHref } from "../restaurant/urls.ts";
import type { UserNotification } from "../../types/notification.ts";

function alert(id: number, readAt: string | null = null): UserNotification {
  return {
    id,
    kind: "deal_new",
    title: "Two for one thali",
    location_id: 7,
    restaurant_name: "Spice Route",
    city: "Irving",
    brand_slug: "spice-route",
    location_slug: "irving",
    created_at: "2026-10-28T12:00:00Z",
    read_at: readAt,
  };
}

const NOW = "2026-10-28T13:00:00Z";

test("badge is hidden at zero/invalid, shows the count, caps at 99+", () => {
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(-3), null);
  assert.equal(badgeText(Number.NaN), null);
  assert.equal(badgeText(1), "1");
  assert.equal(badgeText(99), "99");
  assert.equal(badgeText(100), "99+");
});

test("bell label carries the unread count for screen readers", () => {
  assert.equal(bellLabel(0), "Deal alerts, no unread");
  assert.equal(bellLabel(3), "Deal alerts, 3 unread");
  assert.equal(bellLabel(250), "Deal alerts, 250 unread");
});

test("an alert links to the location page's deals section", () => {
  assert.equal(notificationHref(alert(1)), "/restaurant/spice-route/irving#deals");
  // Stays in lockstep with the shared URL helper.
  assert.equal(notificationHref(alert(1)), locationDealsHref("spice-route", "irving"));
});

test("headline names the restaurant", () => {
  assert.equal(notificationHeadline(alert(1)), "Spice Route has a new deal");
});

test("markReadLocally marks one unread alert and decrements once", () => {
  const state: BellState = { items: [alert(1), alert(2)], unread: 5 };
  const next = markReadLocally(state, 1, NOW);
  assert.equal(next.items[0].read_at, NOW);
  assert.equal(next.items[1].read_at, null);
  assert.equal(next.unread, 4);
  // Original untouched (immutable update).
  assert.equal(state.items[0].read_at, null);
});

test("markReadLocally is idempotent and ignores unknown ids", () => {
  const state: BellState = { items: [alert(1, "2026-10-01T00:00:00Z")], unread: 2 };
  assert.equal(markReadLocally(state, 1, NOW), state);
  assert.equal(markReadLocally(state, 99, NOW), state);
});

test("markReadLocally never drives unread below zero", () => {
  const state: BellState = { items: [alert(1)], unread: 0 };
  assert.equal(markReadLocally(state, 1, NOW).unread, 0);
});

test("markAllReadLocally reads everything and zeroes unread, keeping old read stamps", () => {
  const old = "2026-10-01T00:00:00Z";
  const next = markAllReadLocally({ items: [alert(1), alert(2, old)], unread: 12 }, NOW);
  assert.equal(next.unread, 0);
  assert.equal(next.items[0].read_at, NOW);
  assert.equal(next.items[1].read_at, old);
});

const plain: ClickLike = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

test("a plain primary click is intercepted; modified / non-primary / handled clicks are not", () => {
  assert.equal(shouldInterceptClick(plain), true);
  assert.equal(shouldInterceptClick({ ...plain, metaKey: true }), false);
  assert.equal(shouldInterceptClick({ ...plain, ctrlKey: true }), false);
  assert.equal(shouldInterceptClick({ ...plain, shiftKey: true }), false);
  assert.equal(shouldInterceptClick({ ...plain, altKey: true }), false);
  assert.equal(shouldInterceptClick({ ...plain, button: 1 }), false);
  assert.equal(shouldInterceptClick({ ...plain, defaultPrevented: true }), false);
});
