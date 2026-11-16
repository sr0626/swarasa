// Unit tests for the pure form-guard helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGuardHeaders,
  FORM_NAMES,
  firstForwardedIp,
  guardErrorMessage,
  GUARD_FAILED_MESSAGE,
  GUARD_RATE_LIMITED_MESSAGE,
  isFormName,
  isGuardFailure,
  isTrapTripped,
  msUntilSubmittable,
  parseTokenResponse,
  SUBMIT_MARGIN_MS,
  tokenIsStale,
  TOKEN_REFRESH_AFTER_MS,
  TRAP_FIELD_NAME,
} from "./guardLogic.ts";

test("isFormName accepts only known forms", () => {
  for (const name of FORM_NAMES) assert.equal(isFormName(name), true);
  for (const bad of ["", "nope", "REPORT", null, undefined, 3, {}]) {
    assert.equal(isFormName(bad), false);
  }
});

test("the trap field does not look like an autofill target", () => {
  assert.doesNotMatch(TRAP_FIELD_NAME, /email|phone|name|website|url|address|honey|trap|user|pass/i);
});

test("isTrapTripped: any non-blank string trips it", () => {
  assert.equal(isTrapTripped("http://spam"), true);
  assert.equal(isTrapTripped(" x "), true);
  for (const quiet of ["", "   ", "\n", null, undefined, 0, false]) {
    assert.equal(isTrapTripped(quiet), false);
  }
});

test("msUntilSubmittable waits out the minimum plus the margin, never negative", () => {
  assert.equal(msUntilSubmittable(1_000, 1_000, 3), 3_000 + SUBMIT_MARGIN_MS);
  assert.equal(msUntilSubmittable(1_000, 2_000, 3), 2_000 + SUBMIT_MARGIN_MS);
  assert.equal(msUntilSubmittable(1_000, 1_000 + 3_000 + SUBMIT_MARGIN_MS, 3), 0);
  assert.equal(msUntilSubmittable(1_000, 999_999, 3), 0);
  assert.equal(msUntilSubmittable(1_000, 1_000, 0), SUBMIT_MARGIN_MS);
  assert.equal(msUntilSubmittable(1_000, 1_000, -5), SUBMIT_MARGIN_MS);
});

test("tokenIsStale flips at the refresh window", () => {
  assert.equal(tokenIsStale(0, TOKEN_REFRESH_AFTER_MS - 1), false);
  assert.equal(tokenIsStale(0, TOKEN_REFRESH_AFTER_MS), true);
});

test("parseTokenResponse validates and clamps", () => {
  assert.deepEqual(parseTokenResponse({ token: "1.n.s", min_seconds: 3 }), { token: "1.n.s", minSeconds: 3 });
  assert.equal(parseTokenResponse({ token: "1.n.s", min_seconds: 999 })?.minSeconds, 30);
  assert.equal(parseTokenResponse({ token: "1.n.s", min_seconds: -2 })?.minSeconds, 0);
  for (const bad of [
    null,
    "x",
    [],
    {},
    { token: "", min_seconds: 3 },
    { token: "x".repeat(201), min_seconds: 3 },
    { token: 5, min_seconds: 3 },
    { token: "a", min_seconds: "3" },
    { token: "a", min_seconds: Number.NaN },
  ]) {
    assert.equal(parseTokenResponse(bad), null);
  }
});

test("firstForwardedIp takes the first hop, falls back to x-real-ip, rejects junk", () => {
  assert.equal(firstForwardedIp("203.0.113.9, 10.0.0.1, 10.0.0.2", null), "203.0.113.9");
  assert.equal(firstForwardedIp("  203.0.113.9  ", "1.1.1.1"), "203.0.113.9");
  assert.equal(firstForwardedIp(null, "198.51.100.4"), "198.51.100.4");
  assert.equal(firstForwardedIp("", "198.51.100.4"), "198.51.100.4");
  assert.equal(firstForwardedIp("2001:db8::1, 10.0.0.1", null), "2001:db8::1");
  assert.equal(firstForwardedIp(null, null), null);
  assert.equal(firstForwardedIp(undefined, undefined), null);
  assert.equal(firstForwardedIp("a".repeat(65), null), null);
  assert.equal(firstForwardedIp("bad value", null), null);
  assert.equal(firstForwardedIp("\u0001x", null), null);
});

test("buildGuardHeaders attaches token, trap (only when filled) and visitor ip", () => {
  assert.deepEqual(buildGuardHeaders({ token: "t.o.k", trap: "" }, "203.0.113.9"), {
    "X-Form-Token": "t.o.k",
    "X-Visitor-IP": "203.0.113.9",
  });
  assert.deepEqual(buildGuardHeaders({ token: "t.o.k", trap: " bot " }, null), {
    "X-Form-Token": "t.o.k",
    "X-Form-Trap": "bot",
  });
  assert.deepEqual(buildGuardHeaders({ token: null, trap: "" }, null), {});
});

test("buildGuardHeaders tolerates garbage payloads and bounds sizes", () => {
  for (const junk of [null, undefined, "x", 7, [], { token: 5, trap: {} }]) {
    assert.deepEqual(buildGuardHeaders(junk, null), {});
  }
  assert.deepEqual(buildGuardHeaders({ token: "x".repeat(201) }, null), {});
  assert.equal(buildGuardHeaders({ trap: "y".repeat(900) }, null)["X-Form-Trap"]?.length, 200);
});

test("guard failures map to one friendly message each, other errors to null", () => {
  assert.equal(isGuardFailure(400, "form_check_failed"), true);
  assert.equal(isGuardFailure(429, "rate_limited"), true);
  assert.equal(isGuardFailure(400, "invalid_location"), false);
  assert.equal(isGuardFailure(429, "other"), false);
  assert.equal(guardErrorMessage(400, "form_check_failed"), GUARD_FAILED_MESSAGE);
  assert.equal(guardErrorMessage(429, "rate_limited"), GUARD_RATE_LIMITED_MESSAGE);
  assert.equal(guardErrorMessage(400, "bad_request"), null);
  assert.equal(guardErrorMessage(500, null), null);
  assert.equal(guardErrorMessage(400, undefined), null);
});
