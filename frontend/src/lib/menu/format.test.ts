// Unit tests for the menu display/reorder helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { formatItemPrice, formatSizesInline, isMenuEmpty, moveId, moveRow } from "./format.ts";

test("formatSizesInline joins sizes with a middle dot", () => {
  assert.equal(
    formatSizesInline([
      { label: "Personal", price: "$10" },
      { label: "Double", price: "$15" },
      { label: "Family Pack", price: "$25" },
    ]),
    "Personal $10 · Double $15 · Family Pack $25"
  );
});

test("formatSizesInline skips blank rows and tolerates null/empty", () => {
  assert.equal(formatSizesInline(null), "");
  assert.equal(formatSizesInline([]), "");
  assert.equal(
    formatSizesInline([
      { label: " ", price: "$1" },
      { label: "Half", price: " $5 " },
    ]),
    "Half $5"
  );
});

test("formatItemPrice: single price unchanged, sized item shows its sizes", () => {
  assert.equal(formatItemPrice({ price: " $12 ", sizes: null }), "$12");
  assert.equal(formatItemPrice({ price: "12 / 18", sizes: null }), "12 / 18");
  assert.equal(
    formatItemPrice({ price: null, sizes: [{ label: "Half", price: "$5" }, { label: "Full", price: "$9" }] }),
    "Half $5 · Full $9"
  );
});

test("moveId moves up/down and is a no-op (copy) at the ends", () => {
  assert.deepEqual(moveId([1, 2, 3], 1, -1), [2, 1, 3]);
  assert.deepEqual(moveId([1, 2, 3], 1, 1), [1, 3, 2]);
  const ids = [1, 2, 3];
  assert.deepEqual(moveId(ids, 0, -1), [1, 2, 3]);
  assert.deepEqual(moveId(ids, 2, 1), [1, 2, 3]);
  assert.deepEqual(moveId(ids, 9, 1), [1, 2, 3]);
  // never mutates its input
  moveId(ids, 0, 1);
  assert.deepEqual(ids, [1, 2, 3]);
});

test("moveRow works on row objects", () => {
  const rows = [{ label: "A" }, { label: "B" }];
  assert.deepEqual(moveRow(rows, 0, 1).map((r) => r.label), ["B", "A"]);
});

test("isMenuEmpty is true only when there are no items anywhere", () => {
  assert.equal(isMenuEmpty({ ungrouped_items: [], sections: [] }), true);
  // A group with no items renders nothing publicly, so the menu is still empty.
  assert.equal(isMenuEmpty({ ungrouped_items: [], sections: [{ items: [] }] }), true);
  assert.equal(isMenuEmpty({ ungrouped_items: [{}], sections: [] }), false);
  assert.equal(isMenuEmpty({ ungrouped_items: [], sections: [{ items: [{}] }] }), false);
});
