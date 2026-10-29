// Unit tests for the admin claim review helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_NOTES_MAX_LENGTH,
  notesCounter,
  notesEditedLead,
  reviewedByLead,
  reviewerLabel,
  validateClaimNotes,
} from "./claimReview.ts";

test("reviewerLabel prefers the email", () => {
  assert.equal(reviewerLabel("admin1@example.com", "1234567890abcdef"), "admin1@example.com");
});

test("reviewerLabel falls back to 'admin' + the first 8 chars of the sub", () => {
  assert.equal(reviewerLabel(null, "1234567890abcdef"), "admin 12345678");
  assert.equal(reviewerLabel("  ", "abcdef1234567"), "admin abcdef12");
  assert.equal(reviewerLabel(undefined, "short"), "admin short");
});

test("reviewerLabel with nothing known reads 'an admin'", () => {
  assert.equal(reviewerLabel(null, null), "an admin");
  assert.equal(reviewerLabel(undefined, ""), "an admin");
});

test("reviewedByLead for approved and rejected claims", () => {
  assert.equal(
    reviewedByLead({ status: "approved", reviewed_by: "sub-1", reviewed_by_email: "a@x.com" }),
    "Approved by a@x.com"
  );
  assert.equal(
    reviewedByLead({ status: "rejected", reviewed_by: "abcdef1234", reviewed_by_email: null }),
    "Rejected by admin abcdef12"
  );
});

test("reviewedByLead is null for a pending claim", () => {
  assert.equal(reviewedByLead({ status: "pending_review", reviewed_by: null }), null);
});

test("notesEditedLead only when the note was edited after the review", () => {
  assert.equal(notesEditedLead({ notes_edited_at: null }), null);
  assert.equal(notesEditedLead({}), null);
  assert.equal(
    notesEditedLead({
      notes_edited_at: "2026-10-28T20:29:00Z",
      notes_edited_by: "sub-2",
      notes_edited_by_email: "b@x.com",
    }),
    "Note last edited by b@x.com"
  );
  assert.equal(
    notesEditedLead({ notes_edited_at: "2026-10-28T20:29:00Z", notes_edited_by: "99887766aa" }),
    "Note last edited by admin 99887766"
  );
});

test("validateClaimNotes trims and keeps optional notes optional", () => {
  assert.deepEqual(validateClaimNotes("  Verified by phone  ", { required: false }), {
    ok: true,
    value: "Verified by phone",
  });
  assert.deepEqual(validateClaimNotes("   ", { required: false }), { ok: true, value: "" });
});

test("validateClaimNotes requires a non-blank note when required", () => {
  const result = validateClaimNotes("   ", { required: true });
  assert.equal(result.ok, false);
});

test("validateClaimNotes enforces the max length after trimming", () => {
  assert.equal(validateClaimNotes("x".repeat(CLAIM_NOTES_MAX_LENGTH), { required: false }).ok, true);
  assert.equal(
    validateClaimNotes(`  ${"x".repeat(CLAIM_NOTES_MAX_LENGTH)}  `, { required: false }).ok,
    true
  );
  const tooLong = validateClaimNotes("x".repeat(CLAIM_NOTES_MAX_LENGTH + 1), { required: false });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.match(tooLong.error, /at most 2000/);
});

test("notesCounter shows used / max", () => {
  assert.equal(notesCounter("hello"), "5 / 2000");
});
