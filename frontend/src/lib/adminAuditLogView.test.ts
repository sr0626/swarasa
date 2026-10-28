// Unit tests for the admin audit-log view helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_PATTERN,
  ENTITY_PATTERN,
  buildAuditHref,
  changedKeys,
  entityLabel,
  isTruncatedSnapshot,
  parseDateParam,
  parseToken,
  snapshotText,
} from "./adminAuditLogView.ts";

test("entityLabel humanises table names", () => {
  assert.equal(entityLabel("restaurant_brand"), "Restaurant brand");
  assert.equal(entityLabel("cognito_user"), "Cognito user");
});

test("parseDateParam accepts only real YYYY-MM-DD dates", () => {
  assert.equal(parseDateParam("2026-10-28"), "2026-10-28");
  assert.equal(parseDateParam("2026-02-30"), undefined);
  assert.equal(parseDateParam("28/10/2026"), undefined);
  assert.equal(parseDateParam("2026-10-28T00:00"), undefined);
  assert.equal(parseDateParam(undefined), undefined);
});

test("parseToken enforces the API's accepted charset", () => {
  assert.equal(parseToken("restaurant_brand", ENTITY_PATTERN), "restaurant_brand");
  assert.equal(parseToken("x'; drop table", ENTITY_PATTERN), undefined);
  assert.equal(parseToken("Update", ACTION_PATTERN), undefined);
  assert.equal(parseToken("update", ACTION_PATTERN), "update");
});

test("buildAuditHref omits blanks and encodes values", () => {
  assert.equal(buildAuditHref({}), "/admin/audit-log");
  assert.equal(buildAuditHref({ page: 1 }), "/admin/audit-log");
  assert.equal(
    buildAuditHref({
      entity: "restaurant_brand",
      action: "update",
      actor: "a+b@x.com",
      date_from: "2026-10-01",
      date_to: "2026-10-28",
      page: 2,
    }),
    "/admin/audit-log?entity=restaurant_brand&action=update&actor=a%2Bb%40x.com&date_from=2026-10-01&date_to=2026-10-28&page=2"
  );
});

test("snapshotText returns escaped-text-safe JSON and never interprets markup", () => {
  assert.equal(snapshotText(null), "(none)");
  assert.equal(snapshotText({}), "(none)");
  const text = snapshotText({ name: "<script>alert(1)</script>", n: 1 });
  // Plain string: React will escape it; the markup is not altered or executed.
  assert.ok(text.includes("<script>alert(1)</script>"));
  assert.equal(JSON.parse(text).n, 1);
});

test("truncated snapshots render their preview as text with a marker", () => {
  const snap = { _truncated: true, _preview: '{"blob":"xxxx' };
  assert.equal(isTruncatedSnapshot(snap), true);
  assert.equal(isTruncatedSnapshot({ a: 1 }), false);
  assert.equal(isTruncatedSnapshot(null), false);
  assert.match(snapshotText(snap), /truncated/);
});

test("changedKeys lists only differing keys", () => {
  assert.deepEqual(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), ["b", "c"]);
  assert.deepEqual(changedKeys(null, { a: 1 }), ["a"]);
  assert.deepEqual(changedKeys(null, null), []);
});
