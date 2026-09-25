// Unit tests for the editor's active-section pick.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { isAtPageBottom, pickActiveSectionId } from "./activeSection.ts";

const LINE = 130;
const VH = 800;

function pos(...tops: number[]) {
  const ids = ["deals", "sec-hours", "menu", "sec-photos", "sec-about", "sec-info", "sec-managers"];
  return tops.map((top, i) => ({ id: ids[i]!, top }));
}

test("picks the last section whose top is above the line, not the first visible one", () => {
  // Info's top is above the line but Managers already fills the screen (top 90 <= 130).
  const positions = pos(-2400, -1900, -1500, -900, -500, -120, 90);
  assert.equal(
    pickActiveSectionId({ positions, line: LINE, viewportHeight: VH, atPageBottom: false }),
    "sec-managers"
  );
});

test("a section whose top is still below the line is not active yet", () => {
  const positions = pos(-600, -100, 400, 900);
  assert.equal(
    pickActiveSectionId({ positions, line: LINE, viewportHeight: VH, atPageBottom: false }),
    "sec-hours"
  );
});

test("at the page bottom the final section wins even if its top never reached the line", () => {
  const positions = pos(-2400, -1900, -1500, -900, -500, -120, 420);
  assert.equal(
    pickActiveSectionId({ positions, line: LINE, viewportHeight: VH, atPageBottom: true }),
    "sec-managers"
  );
  assert.equal(
    pickActiveSectionId({ positions, line: LINE, viewportHeight: VH, atPageBottom: false }),
    "sec-info"
  );
});

test("near the top of the page: first section already in the upper viewport, else nothing", () => {
  assert.equal(
    pickActiveSectionId({ positions: pos(300, 900, 1400), line: LINE, viewportHeight: VH, atPageBottom: false }),
    "deals"
  );
  assert.equal(
    pickActiveSectionId({ positions: pos(700, 1200, 1700), line: LINE, viewportHeight: VH, atPageBottom: false }),
    null
  );
});

test("a jump link lands its target just under the stack and that section becomes active", () => {
  // scroll-margin puts the target ~16px under the ~113px stack (top 129 <= 130).
  const positions = pos(-1400, -700, 129, 800, 1300);
  assert.equal(
    pickActiveSectionId({ positions, line: LINE, viewportHeight: VH, atPageBottom: false }),
    "menu"
  );
});

test("no sections -> null", () => {
  assert.equal(pickActiveSectionId({ positions: [], line: LINE, viewportHeight: VH, atPageBottom: true }), null);
});

test("isAtPageBottom needs a scrollable page and to be within 2px of the end", () => {
  assert.equal(isAtPageBottom(1200, 800, 2000), true);
  assert.equal(isAtPageBottom(1199, 800, 2000), true);
  assert.equal(isAtPageBottom(1100, 800, 2000), false);
  assert.equal(isAtPageBottom(0, 800, 800), false); // page fits the viewport
});
