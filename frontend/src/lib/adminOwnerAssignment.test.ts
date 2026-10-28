// Unit tests for the admin owner-assignment helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAssignment,
  assignBlockedReason,
  assignConfirmText,
  assignSummary,
  assignTarget,
  canAssignOwner,
  looksLikeEmail,
  ownerOptionLabel,
} from "./adminOwnerAssignment.ts";

const result = {
  brand_id: 7,
  owner_id: 12,
  owner_email: "owner@example.com",
  is_claimed: true,
  owner_account_created: false,
  revoked_manager_count: 0,
};

test("looksLikeEmail", () => {
  assert.equal(looksLikeEmail("a@b.co"), true);
  assert.equal(looksLikeEmail("  a@b.co "), true);
  for (const bad of ["", "   ", "a", "a@", "@b.co", "a@b", "a b@c.co", "a@b@c.co", "a@.co", "a@b."]) {
    assert.equal(looksLikeEmail(bad), false, bad);
  }
});

test("canAssignOwner only for live, ownerless, claim-free brands", () => {
  const base = { owner_id: null, deleted_at: null, has_pending_claim: false };
  assert.equal(canAssignOwner(base), true);
  assert.equal(canAssignOwner({ ...base, owner_id: 3 }), false);
  assert.equal(canAssignOwner({ ...base, deleted_at: "2026-10-01T00:00:00Z" }), false);
  assert.equal(canAssignOwner({ ...base, has_pending_claim: true }), false);
});

test("assignBlockedReason explains only the pending-claim case", () => {
  const base = { owner_id: null, deleted_at: null, has_pending_claim: false };
  assert.equal(assignBlockedReason(base), null);
  assert.match(assignBlockedReason({ ...base, has_pending_claim: true }) ?? "", /pending claim/);
  assert.equal(assignBlockedReason({ ...base, owner_id: 1, has_pending_claim: true }), null);
  assert.equal(assignBlockedReason({ ...base, deleted_at: "x", has_pending_claim: true }), null);
});

test("assignTarget prefers a picked owner, else a valid typed email, else null", () => {
  assert.deepEqual(assignTarget(5, "x@y.co"), { owner_id: 5 });
  assert.deepEqual(assignTarget(null, "  New@Owner.COM "), { owner_email: "new@owner.com" });
  assert.equal(assignTarget(null, "not an email"), null);
  assert.equal(assignTarget(null, ""), null);
});

test("ownerOptionLabel handles name, pluralisation and deleted accounts", () => {
  assert.equal(
    ownerOptionLabel({ email: "a@b.co", full_name: "Priya", brand_count: 1 }),
    "a@b.co — Priya (1 restaurant)"
  );
  assert.equal(
    ownerOptionLabel({ email: "a@b.co", full_name: null, brand_count: 0 }),
    "a@b.co (0 restaurants)"
  );
  assert.match(ownerOptionLabel({ email: null, full_name: null, brand_count: 2 }), /^Deleted account/);
});

test("assignConfirmText names the brand and target and says tier is unchanged", () => {
  const text = assignConfirmText("Spice Garden", "a@b.co");
  assert.match(text, /Spice Garden/);
  assert.match(text, /a@b\.co/);
  assert.match(text, /tier is not changed/i);
});

test("assignSummary mentions account creation and manager removals only when relevant", () => {
  assert.equal(assignSummary(result), "Assigned to owner@example.com.");
  assert.match(assignSummary({ ...result, owner_account_created: true }), /owner account was created/);
  assert.match(assignSummary({ ...result, revoked_manager_count: 1 }), /1 existing manager assignment was removed/);
  assert.match(assignSummary({ ...result, revoked_manager_count: 3 }), /3 existing manager assignments were removed/);
});

test("applyAssignment updates ownership fields only and does not mutate the input", () => {
  const brand = {
    id: 7,
    owner_id: null,
    owner_email: null,
    owner_deleted: false,
    is_claimed: false,
    name: "X",
  };
  const next = applyAssignment(brand, result);
  assert.equal(next.owner_id, 12);
  assert.equal(next.owner_email, "owner@example.com");
  assert.equal(next.is_claimed, true);
  assert.equal(next.name, "X");
  assert.equal(brand.owner_id, null);
});
