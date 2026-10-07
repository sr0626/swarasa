// Unit tests for the /privacy page role rule and latest-request picker.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { latestDeletionRequestOf, privacyPageModeFor } from "./access.ts";
import type { DataDeletionRequest } from "../../types/privacy.ts";

function req(id: string, submitted_at: string): DataDeletionRequest {
  return { id, submitted_at, status: "pending_review" } as unknown as DataDeletionRequest;
}

test("admins get the staff note; every other role gets the controls", () => {
  assert.equal(privacyPageModeFor("admin"), "staff-note");
  for (const role of ["owner", "manager", "registered_user"] as const) {
    assert.equal(privacyPageModeFor(role), "controls");
  }
});

test("latestDeletionRequestOf picks the newest and handles empty", () => {
  assert.equal(latestDeletionRequestOf([]), null);
  const a = req("a", "2026-09-01T10:00:00Z");
  const b = req("b", "2026-10-01T10:00:00Z");
  assert.equal(latestDeletionRequestOf([a, b]), b);
  assert.equal(latestDeletionRequestOf([b, a]), b);
});
