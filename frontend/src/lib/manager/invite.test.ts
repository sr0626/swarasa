// Unit tests for the manager invite UI rules.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  INVITES_PER_OWNER_PER_DAY,
  INVITE_TTL_DAYS,
  acceptInviteErrorMessage,
  buildInviteLink,
  createInviteErrorMessage,
  inviteLandingFor,
  invitePath,
  inviteStatusLabel,
  isInviteNextPath,
  isPlausibleInviteToken,
  normalizeInviteEmail,
  orderInvites,
  validateInviteEmail,
} from "./invite.ts";

const TOKEN = "A".repeat(43);

test("email is trimmed and lowercased like the API does", () => {
  assert.equal(normalizeInviteEmail("  Sam.Cook@Example.COM "), "sam.cook@example.com");
});

test("validateInviteEmail accepts normal addresses and explains bad ones", () => {
  assert.equal(validateInviteEmail("sam@example.com"), null);
  assert.equal(validateInviteEmail("  Sam@Example.com  "), null);
  assert.match(validateInviteEmail("") ?? "", /Enter the email/);
  assert.match(validateInviteEmail("   ") ?? "", /Enter the email/);
  for (const bad of ["nope", "a@b", "two words@x.com", "@x.com", "a@@x.com"]) {
    assert.match(validateInviteEmail(bad) ?? "", /valid email/, bad);
  }
  assert.match(validateInviteEmail(`${"a".repeat(250)}@x.com`) ?? "", /valid email/);
});

test("token plausibility guard", () => {
  assert.equal(isPlausibleInviteToken(TOKEN), true);
  assert.equal(isPlausibleInviteToken("abc_DEF-123".repeat(3)), true);
  for (const bad of ["", "short", "has space " + "a".repeat(30), "../etc/passwd" + "a".repeat(20), "a".repeat(200), 42, null, undefined]) {
    assert.equal(isPlausibleInviteToken(bad), false, String(bad));
  }
});

test("invite link is origin + /invite/<token>, trailing slashes tolerated", () => {
  assert.equal(invitePath(TOKEN), `/invite/${TOKEN}`);
  assert.equal(buildInviteLink("https://swarasa.example", TOKEN), `https://swarasa.example/invite/${TOKEN}`);
  assert.equal(buildInviteLink("https://swarasa.example///", TOKEN), `https://swarasa.example/invite/${TOKEN}`);
});

test("only /invite/ next paths switch sign-up into invite mode", () => {
  assert.equal(isInviteNextPath(`/invite/${TOKEN}`), true);
  assert.equal(isInviteNextPath("/portal/locations/3"), false);
  assert.equal(isInviteNextPath("/invites"), false);
  assert.equal(isInviteNextPath(null), false);
  assert.equal(isInviteNextPath(undefined), false);
});

test("landing: diners and managers can accept; owners/admins cannot; signed-out signs in", () => {
  assert.equal(inviteLandingFor(null), "signed_out");
  assert.equal(inviteLandingFor("registered_user"), "can_accept");
  assert.equal(inviteLandingFor("manager"), "can_accept");
  assert.equal(inviteLandingFor("owner"), "wrong_account_type");
  assert.equal(inviteLandingFor("admin"), "wrong_account_type");
});

test("pending invites sort ahead of expired ones, order otherwise kept", () => {
  const mk = (id: number, status: "pending" | "expired") => ({
    id,
    location_id: 1,
    email: `p${id}@x.com`,
    status,
    created_at: "2026-10-28T00:00:00Z",
    expires_at: "2026-11-11T00:00:00Z",
  });
  const ordered = orderInvites([mk(1, "expired"), mk(2, "pending"), mk(3, "expired"), mk(4, "pending")]);
  assert.deepEqual(ordered.map((i) => i.id), [2, 4, 1, 3]);
});

test("status labels", () => {
  assert.equal(inviteStatusLabel("pending"), "Pending");
  assert.equal(inviteStatusLabel("expired"), "Expired");
});

test("create errors: generic 429 passes through, no cross-tenant hints", () => {
  assert.equal(createInviteErrorMessage(429, "Too many today"), "Too many today");
  assert.match(createInviteErrorMessage(429, null), /too many invitations/);
  assert.match(createInviteErrorMessage(403, "x"), /permission/);
  assert.match(createInviteErrorMessage(422, null), /valid email/);
  assert.equal(createInviteErrorMessage(409, "Cap reached"), "Cap reached");
  assert.match(createInviteErrorMessage(null, null), /Could not create/);
});

test("accept errors: 404 stays generic and tells the invitee what to check", () => {
  const msg = acceptInviteErrorMessage(404, "ignored");
  assert.match(msg, /invalid, has expired, or was sent to a different email/);
  assert.equal(acceptInviteErrorMessage(409, "We couldn't complete this invitation."), "We couldn't complete this invitation.");
  assert.match(acceptInviteErrorMessage(null, null), /couldn't complete/);
});

test("constants mirror the backend", () => {
  assert.equal(INVITE_TTL_DAYS, 14);
  assert.equal(INVITES_PER_OWNER_PER_DAY, 20);
});
