// Unit tests for the admin listings helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { deleteListingWarning, parseListingStatusFilter } from "./adminListings.ts";

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
