// Unit tests for the admin listings helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCATION_STATUS_LABELS,
  addressLine,
  creatorText,
  deleteListingWarning,
  hasLocationFilter,
  matchSummary,
  ownerLine,
  parseListingStatusFilter,
} from "./adminListings.ts";

test("deleteListingWarning states the count of locations that will be deactivated", () => {
  assert.match(deleteListingWarning(3), /deactivate all 3 of its active locations/);
  assert.match(deleteListingWarning(1), /deactivate its 1 active location\./);
  assert.match(deleteListingWarning(0), /no active locations to deactivate/);
});

test("deleteListingWarning says it hides the listing from the public and is restorable", () => {
  const text = deleteListingWarning(2);
  assert.match(text, /hidden from the public/);
  assert.match(text, /restore/);
});

test("parseListingStatusFilter accepts location statuses and the deleted pseudo-status", () => {
  assert.equal(parseListingStatusFilter("deleted"), "deleted");
  assert.equal(parseListingStatusFilter("active"), "active");
  assert.equal(parseListingStatusFilter("closed_pending_reopen"), "closed_pending_reopen");
});

test("parseListingStatusFilter treats anything else as no filter", () => {
  assert.equal(parseListingStatusFilter(undefined), undefined);
  assert.equal(parseListingStatusFilter(""), undefined);
  assert.equal(parseListingStatusFilter("nonsense"), undefined);
});

test("ownerLine: email, Unclaimed, deleted account, and id fallback", () => {
  assert.equal(
    ownerLine({ owner_id: 4, owner_email: "boss@example.com", owner_deleted: false }),
    "Owner: boss@example.com"
  );
  assert.equal(ownerLine({ owner_id: null, owner_email: null, owner_deleted: false }), "Unclaimed");
  assert.equal(
    ownerLine({ owner_id: 4, owner_email: null, owner_deleted: true }),
    "Owner: deleted account"
  );
  assert.equal(ownerLine({ owner_id: 4, owner_email: null, owner_deleted: false }), "Owner: #4");
});

test("creatorText puts the role in brackets, and is null when the creator is unknown", () => {
  assert.equal(
    creatorText({ created_by_role: "admin", created_by_label: "root@example.com" }),
    "root@example.com (admin)"
  );
  assert.equal(
    creatorText({ created_by_role: "manager", created_by_label: "mgr@example.com" }),
    "mgr@example.com (manager)"
  );
  assert.equal(
    creatorText({ created_by_role: "system", created_by_label: "import" }),
    "import (system)"
  );
  // Role known but only the short sub is available.
  assert.equal(
    creatorText({ created_by_role: "owner", created_by_label: "3f2a9c1d" }),
    "3f2a9c1d (owner)"
  );
  assert.equal(creatorText({ created_by_role: null, created_by_label: null }), null);
});

test("hasLocationFilter ignores brand-level filters and the deleted pseudo-status", () => {
  assert.equal(hasLocationFilter({}), false);
  assert.equal(hasLocationFilter({ status: "deleted" }), false);
  assert.equal(hasLocationFilter({ status: "coming_soon" }), true);
  assert.equal(hasLocationFilter({ isPaid: false }), true);
  assert.equal(hasLocationFilter({ city: "Plano" }), true);
  assert.equal(hasLocationFilter({ city: "" }), false);
});

test("matchSummary counts the highlighted locations", () => {
  assert.equal(
    matchSummary([{ matches_filter: true }, { matches_filter: false }, { matches_filter: false }]),
    "1 of 3 locations match"
  );
  assert.equal(matchSummary([{ matches_filter: true }]), "1 of 1 location match");
  assert.equal(matchSummary([]), "0 of 0 locations match");
});

test("addressLine skips empty parts without stray commas", () => {
  assert.equal(
    addressLine({
      address_line1: "123 Main St",
      address_line2: "Suite 4",
      city: "Plano",
      state: "TX",
      postal_code: "75024",
    }),
    "123 Main St, Suite 4, Plano, TX 75024"
  );
  assert.equal(
    addressLine({
      address_line1: "9 Elm",
      address_line2: null,
      city: "Irving",
      state: "TX",
      postal_code: "",
    }),
    "9 Elm, Irving, TX"
  );
});

test("every location status has a label, including Coming soon", () => {
  assert.equal(LOCATION_STATUS_LABELS.coming_soon, "Coming soon");
  assert.equal(Object.keys(LOCATION_STATUS_LABELS).length, 4);
});
