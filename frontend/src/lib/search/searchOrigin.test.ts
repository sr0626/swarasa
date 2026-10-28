// Unit tests for search-origin precedence (saved ZIP vs explicit location).
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { idleOriginNote, originNote, originSearchParams, resolveSearchOrigin, zip5 } from "./searchOrigin.ts";

const SAVED = { city: "Dallas", postal_code: "75201" };

test("an explicit location always wins over the saved ZIP", () => {
  const origin = resolveSearchOrigin({ explicitLocation: "Plano", saved: SAVED });
  assert.deepEqual(origin, { kind: "explicit" });
  assert.deepEqual(originSearchParams(origin), {});
  assert.equal(originNote(origin), null);
});

test("whitespace-only explicit location does not count as explicit", () => {
  assert.equal(resolveSearchOrigin({ explicitLocation: "  ", saved: SAVED }).kind, "saved");
});

test("saved city+ZIP becomes near_zip/near_city when nothing explicit", () => {
  const origin = resolveSearchOrigin({ explicitLocation: "", saved: SAVED });
  assert.deepEqual(origin, { kind: "saved", nearZip: "75201", nearCity: "Dallas", label: "ZIP 75201" });
  assert.deepEqual(originSearchParams(origin), { near_zip: "75201", near_city: "Dallas" });
});

test("ZIP+4 is trimmed to five digits", () => {
  assert.equal(zip5(" 75201-1234 "), "75201");
  const origin = resolveSearchOrigin({ saved: { city: "Dallas", postal_code: "75201-1234" } });
  assert.equal(origin.kind === "saved" && origin.nearZip, "75201");
});

test("signed-out or incomplete saved location -> default (unchanged behaviour)", () => {
  const cases = [null, undefined, {}, { city: "Dallas" }, { postal_code: "75201" }, { city: " ", postal_code: "75201" }];
  for (const saved of cases) {
    const origin = resolveSearchOrigin({ saved });
    assert.deepEqual(origin, { kind: "default" });
    assert.deepEqual(originSearchParams(origin), {});
    assert.equal(originNote(origin), null);
  }
});

test("originNote is honest when the API fell back to the default origin", () => {
  const origin = resolveSearchOrigin({ saved: SAVED });
  assert.deepEqual(originNote(origin), { text: "Searching near ZIP 75201", resolved: true });
  assert.deepEqual(originNote(origin, "saved_zip"), { text: "Searching near ZIP 75201", resolved: true });
  assert.deepEqual(originNote(origin, "saved_city"), { text: "Searching near ZIP 75201", resolved: true });
  assert.equal(originNote(origin, "default")?.resolved, false);
  assert.match(originNote(origin, "default")?.text ?? "", /ZIP 75201/);
});

test("idleOriginNote only for a saved origin (empty /search stays empty)", () => {
  assert.equal(idleOriginNote(resolveSearchOrigin({ saved: SAVED })), "Searches start near ZIP 75201");
  assert.equal(idleOriginNote(resolveSearchOrigin({ saved: null })), null);
  assert.equal(idleOriginNote(resolveSearchOrigin({ explicitLocation: "Plano", saved: SAVED })), null);
});
