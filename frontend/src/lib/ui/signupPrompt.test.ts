// Unit tests for the sign-up popup decision logic.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNUP_PROMPT_STORAGE_KEY,
  SIGNUP_PROMPT_TTL_MS,
  hasScrolledPastThreshold,
  isDismissalActive,
  isTypingTarget,
  nextTrapIndex,
  parseDismissedAt,
  shouldShowSignupPrompt,
} from "./signupPrompt.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const base = { signedIn: false, webdriver: false, dismissedAt: null, now: NOW };

test("constants: namespaced key and 14-day TTL", () => {
  assert.equal(SIGNUP_PROMPT_STORAGE_KEY, "swarasa:signup-prompt:dismissed-at");
  assert.equal(SIGNUP_PROMPT_TTL_MS, 14 * DAY);
});

test("a fresh signed-out visitor sees the popup", () => {
  assert.equal(shouldShowSignupPrompt(base), true);
});

test("signed-in never shows (even with no dismissal)", () => {
  assert.equal(shouldShowSignupPrompt({ ...base, signedIn: true }), false);
  assert.equal(shouldShowSignupPrompt({ ...base, signedIn: true, dismissedAt: NOW - 30 * DAY }), false);
});

test("webdriver never shows", () => {
  assert.equal(shouldShowSignupPrompt({ ...base, webdriver: true }), false);
});

test("dismissed within 14 days hides", () => {
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: NOW - 1000 }), false);
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: NOW - 13 * DAY }), false);
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: NOW - (14 * DAY - 1) }), false);
});

test("expired dismissal (14 days or older) shows again", () => {
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: NOW - 14 * DAY }), true);
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: NOW - 90 * DAY }), true);
});

test("storage unavailable: no stored value, in-memory flag is the only memory", () => {
  // Nothing readable from storage -> parse gives null -> shows once...
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: parseDismissedAt(null) }), true);
  // ...and after a dismissal in this page session, never again this session.
  assert.equal(
    shouldShowSignupPrompt({ ...base, dismissedAt: null, dismissedThisSession: true }),
    false
  );
});

test("session flag hides even when the stored dismissal has expired", () => {
  assert.equal(
    shouldShowSignupPrompt({ ...base, dismissedAt: NOW - 90 * DAY, dismissedThisSession: true }),
    false
  );
});

test("parseDismissedAt: valid integer strings", () => {
  assert.equal(parseDismissedAt("1800000000000"), 1_800_000_000_000);
  assert.equal(parseDismissedAt(" 1800000000000 "), 1_800_000_000_000);
});

test("parseDismissedAt: missing / corrupt values are null", () => {
  for (const raw of [null, undefined, "", "abc", "-5", "0", "1.5", "1e12", "NaN", "{}", "12 34", "9".repeat(20)]) {
    assert.equal(parseDismissedAt(raw), null, `raw=${String(raw)}`);
  }
});

test("corrupt stored value shows the popup", () => {
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: parseDismissedAt("garbage") }), true);
});

test("a dismissal timestamp far in the future is treated as corrupt, not 'dismissed forever'", () => {
  assert.equal(isDismissalActive(NOW + 365 * DAY, NOW), false);
  assert.equal(shouldShowSignupPrompt({ ...base, dismissedAt: NOW + 365 * DAY }), true);
  // small clock skew is tolerated
  assert.equal(isDismissalActive(NOW + 5000, NOW), true);
});

test("isDismissalActive: null is never active", () => {
  assert.equal(isDismissalActive(null, NOW), false);
});

test("hasScrolledPastThreshold: 60% of the page height", () => {
  // 2000px page, 800px viewport: viewport bottom must reach 1200px -> scrollY 400
  assert.equal(hasScrolledPastThreshold(0, 800, 2000), false);
  assert.equal(hasScrolledPastThreshold(399, 800, 2000), false);
  assert.equal(hasScrolledPastThreshold(400, 800, 2000), true);
  assert.equal(hasScrolledPastThreshold(1200, 800, 2000), true);
});

test("hasScrolledPastThreshold: non-scrollable or degenerate pages never trigger", () => {
  assert.equal(hasScrolledPastThreshold(0, 800, 800), false);
  assert.equal(hasScrolledPastThreshold(0, 800, 500), false);
  assert.equal(hasScrolledPastThreshold(100, 0, 2000), false);
  assert.equal(hasScrolledPastThreshold(100, 800, 0), false);
  assert.equal(hasScrolledPastThreshold(Number.NaN, 800, 2000), false);
});

test("isTypingTarget", () => {
  assert.equal(isTypingTarget("INPUT", false), true);
  assert.equal(isTypingTarget("textarea", false), true);
  assert.equal(isTypingTarget("SELECT", false), true);
  assert.equal(isTypingTarget("DIV", true), true);
  assert.equal(isTypingTarget("BUTTON", false), false);
  assert.equal(isTypingTarget("BODY", false), false);
  assert.equal(isTypingTarget(null, false), false);
  assert.equal(isTypingTarget(undefined, false), false);
});

test("nextTrapIndex wraps forward and backward", () => {
  assert.equal(nextTrapIndex(0, 4, false), 1);
  assert.equal(nextTrapIndex(3, 4, false), 0);
  assert.equal(nextTrapIndex(0, 4, true), 3);
  assert.equal(nextTrapIndex(2, 4, true), 1);
});

test("nextTrapIndex pulls stray focus back inside and handles empty lists", () => {
  assert.equal(nextTrapIndex(-1, 4, false), 0);
  assert.equal(nextTrapIndex(-1, 4, true), 3);
  assert.equal(nextTrapIndex(0, 0, false), null);
  assert.equal(nextTrapIndex(0, 1, false), 0);
  assert.equal(nextTrapIndex(0, 1, true), 0);
});
