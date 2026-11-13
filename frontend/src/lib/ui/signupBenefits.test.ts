// Unit tests for the shared sign-up benefits copy.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  BENEFITS_PATH,
  SIGNIN_HREF,
  SIGNUP_BENEFITS,
  SIGNUP_CTA_HREF,
  SIGNUP_CTA_LABEL,
} from "./signupBenefits.ts";

const ICON_KEYS = new Set(["bell", "tag", "heart", "mail", "pin"]);

test("there are exactly five benefits", () => {
  assert.equal(SIGNUP_BENEFITS.length, 5);
});

test("benefit ids, titles and icons are unique", () => {
  assert.equal(new Set(SIGNUP_BENEFITS.map((b) => b.id)).size, SIGNUP_BENEFITS.length);
  assert.equal(new Set(SIGNUP_BENEFITS.map((b) => b.title)).size, SIGNUP_BENEFITS.length);
  assert.equal(new Set(SIGNUP_BENEFITS.map((b) => b.icon)).size, SIGNUP_BENEFITS.length);
});

test("every benefit has non-empty copy and a known icon key", () => {
  for (const b of SIGNUP_BENEFITS) {
    assert.ok(b.id.trim().length > 0);
    assert.ok(b.title.trim().length > 0, `${b.id} title`);
    assert.ok(b.detail.trim().length > 0, `${b.id} detail`);
    assert.ok(ICON_KEYS.has(b.icon), `${b.id} icon ${b.icon}`);
  }
});

test("call-to-action and page hrefs are internal paths", () => {
  assert.equal(SIGNUP_CTA_HREF, "/signup");
  assert.equal(SIGNIN_HREF, "/login");
  assert.equal(BENEFITS_PATH, "/benefits");
  assert.equal(SIGNUP_CTA_LABEL, "Create free account");
  for (const href of [SIGNUP_CTA_HREF, SIGNIN_HREF, BENEFITS_PATH]) {
    assert.ok(href.startsWith("/") && !href.startsWith("//"), href);
  }
});
