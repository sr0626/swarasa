// Unit tests for the footer link set.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { FOOTER_LINKS } from "./footerLinks.ts";

test("footer links include a Your Data link to /privacy", () => {
  const link = FOOTER_LINKS.find((l) => l.href === "/privacy");
  assert.ok(link);
  assert.equal(link.label, "Your Data");
});

test("footer hrefs and labels are unique", () => {
  assert.equal(new Set(FOOTER_LINKS.map((l) => l.href)).size, FOOTER_LINKS.length);
  assert.equal(new Set(FOOTER_LINKS.map((l) => l.label)).size, FOOTER_LINKS.length);
});
