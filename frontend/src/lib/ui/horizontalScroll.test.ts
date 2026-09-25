// Unit tests for the horizontal-scroller geometry.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { centerScrollLeft, scrollEdges } from "./horizontalScroll.ts";

test("centerScrollLeft centers an item in the middle of a long row", () => {
  // 343px scroller, 800px content, 100px item starting at 400: centre 450 -> scrollLeft 278.5 -> 279
  assert.equal(centerScrollLeft(400, 100, 343, 800), 279);
});

test("centerScrollLeft clamps at both ends", () => {
  assert.equal(centerScrollLeft(0, 100, 343, 800), 0);
  assert.equal(centerScrollLeft(700, 100, 343, 800), 457); // max = 800 - 343
});

test("centerScrollLeft is 0 when nothing overflows", () => {
  assert.equal(centerScrollLeft(50, 100, 343, 300), 0);
});

test("scrollEdges reports hidden content on the correct sides", () => {
  assert.deepEqual(scrollEdges(0, 343, 800), { left: false, right: true });
  assert.deepEqual(scrollEdges(200, 343, 800), { left: true, right: true });
  assert.deepEqual(scrollEdges(457, 343, 800), { left: true, right: false });
  assert.deepEqual(scrollEdges(0, 343, 343), { left: false, right: false });
});
