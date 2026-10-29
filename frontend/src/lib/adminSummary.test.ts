// Unit tests for the admin summary strip label/format helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCount,
  listingsSummaryChips,
  managersSummaryChips,
  ownersSummaryChips,
  registeredUsersSummaryChips,
  truncatedNote,
  usersSummaryChips,
} from "./adminSummary.ts";
import type { AdminUsersSummary } from "../types/adminSummary.ts";

const usersSummary: AdminUsersSummary = {
  total: 1204,
  active: 1100,
  inactive: 104,
  unconfirmed: 0,
  seen_last_30_days: 321,
  by_role: { admin: 2, owner: 40, manager: 12, registered_user: 1150 },
  truncated: false,
};

test("formatCount groups thousands and clamps bad input", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(1204), "1,204");
  assert.equal(formatCount(-5), "0");
  assert.equal(formatCount(Number.NaN), "0");
  assert.equal(formatCount(3.9), "3");
});

test("users chips: labels, values and tones", () => {
  const chips = usersSummaryChips(usersSummary);
  const byLabel = Object.fromEntries(chips.map((c) => [c.label, c]));
  assert.equal(byLabel["Total"].value, "1,204");
  assert.equal(byLabel["Active"].value, "1,100");
  assert.equal(byLabel["Inactive (disabled)"].tone, "inactive");
  // zero unconfirmed is not alarming; non-zero is a warning
  assert.equal(byLabel["Unconfirmed"].tone, "neutral");
  const warned = usersSummaryChips({ ...usersSummary, unconfirmed: 3 });
  assert.equal(warned.find((c) => c.label === "Unconfirmed")?.tone, "warning");
  assert.equal(byLabel["Diners"].value, "1,150");
  assert.equal(byLabel["Seen in last 30 days"].value, "321");
});

test("truncated users summary marks the total as a lower bound", () => {
  const chips = usersSummaryChips({ ...usersSummary, truncated: true });
  assert.equal(chips[0].value, "1,204+");
  assert.match(truncatedNote(true) ?? "", /3,000\+ \(capped\)/);
  assert.equal(truncatedNote(false), null);
});

test("registered users, owners, managers and listings chips", () => {
  const diners = registeredUsersSummaryChips({
    total: 10,
    active: 8,
    inactive: 2,
    unconfirmed: 1,
    seen_last_30_days: 4,
    truncated: false,
  });
  assert.deepEqual(
    diners.map((c) => `${c.label}=${c.value}`),
    ["Total=10", "Active=8", "Inactive (disabled)=2", "Unconfirmed=1", "Seen in last 30 days=4"]
  );

  const owners = ownersSummaryChips({ total: 5, active: 3, inactive: 2, without_locations: 1 });
  assert.deepEqual(
    owners.map((c) => c.value),
    ["5", "3", "2", "1"]
  );
  assert.equal(owners[2].tone, "inactive");

  const managers = managersSummaryChips({
    total: 4,
    active: 3,
    inactive: 1,
    seen_last_30_days: 2,
  });
  assert.equal(managers[2].label, "Inactive (all revoked)");

  const listings = listingsSummaryChips({
    brands: 9,
    unclaimed_brands: 0,
    locations: 12,
    active: 8,
    coming_soon: 2,
    owner_deactivated: 1,
    closed_pending_reopen: 1,
  });
  assert.equal(listings[0].label, "Restaurants");
  assert.equal(listings[1].tone, "neutral");
});
