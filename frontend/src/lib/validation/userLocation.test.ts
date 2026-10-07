// Unit tests for the diner city/ZIP schema — mirrors backend/app/schemas/auth.py.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { hasLocation, POSTAL_CODE_ERROR, userLocationSchema } from "./userLocation.ts";

test("accepts a trimmed city and a 5-digit ZIP", () => {
  const parsed = userLocationSchema.parse({ city: "  Plano  ", postal_code: " 75093 " });
  assert.deepEqual(parsed, { city: "Plano", postal_code: "75093" });
});

test("accepts ZIP+4 and collapses inner whitespace in the city", () => {
  const parsed = userLocationSchema.parse({ city: "Fort   Worth", postal_code: "76102-1234" });
  assert.deepEqual(parsed, { city: "Fort Worth", postal_code: "76102-1234" });
});

test("rejects blank city and ZIP with required messages", () => {
  const result = userLocationSchema.safeParse({ city: "   ", postal_code: "" });
  assert.equal(result.success, false);
  const messages = result.success ? [] : result.error.issues.map((i) => i.message);
  assert.ok(messages.includes("City is required"));
  assert.ok(messages.includes("ZIP code is required"));
});

test("rejects a 1-character and a 101-character city", () => {
  assert.equal(userLocationSchema.safeParse({ city: "P", postal_code: "75093" }).success, false);
  assert.equal(
    userLocationSchema.safeParse({ city: "x".repeat(101), postal_code: "75093" }).success,
    false
  );
  assert.equal(
    userLocationSchema.safeParse({ city: "x".repeat(100), postal_code: "75093" }).success,
    true
  );
});

test("rejects malformed ZIPs", () => {
  for (const zip of ["7509", "750931", "ABCDE", "75093-12", "75093 1234"]) {
    const result = userLocationSchema.safeParse({ city: "Plano", postal_code: zip });
    assert.equal(result.success, false, zip);
    if (!result.success) assert.equal(result.error.issues[0]?.message, POSTAL_CODE_ERROR);
  }
});

test("hasLocation needs both city and ZIP", () => {
  assert.equal(hasLocation({ city: "Plano", postal_code: "75093" }), true);
  assert.equal(hasLocation({ city: "Plano", postal_code: null }), false);
  assert.equal(hasLocation({ city: " ", postal_code: "75093" }), false);
  assert.equal(hasLocation(null), false);
});
