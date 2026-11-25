//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_LIMIT_MS,
  isIdle,
  recordActivity,
  shouldTouch,
  startActivity,
  TOUCH_INTERVAL_MS,
} from "./activity.ts";

const MIN = 60_000;

test("continued activity never becomes idle, however long it lasts", () => {
  let state = startActivity(0);
  for (let t = 10 * MIN; t <= 180 * MIN; t += 10 * MIN) {
    state = recordActivity(state, t);
    assert.equal(isIdle(state, t), false);
  }
});

test("a gap longer than the limit is idle", () => {
  const state = startActivity(0);
  assert.equal(isIdle(state, IDLE_LIMIT_MS), false);
  assert.equal(isIdle(state, IDLE_LIMIT_MS + 1), true);
});

test("coming back after an idle gap does not undo it", () => {
  const back = recordActivity(startActivity(0), IDLE_LIMIT_MS + MIN);
  assert.equal(back.lapsed, true);
  assert.equal(isIdle(recordActivity(back, IDLE_LIMIT_MS + 2 * MIN), IDLE_LIMIT_MS + 2 * MIN), true);
});

test("the cookie is re-extended at most once per interval, and well within the limit", () => {
  assert.equal(shouldTouch(null, 0), true);
  assert.equal(shouldTouch(0, TOUCH_INTERVAL_MS - 1), false);
  assert.equal(shouldTouch(0, TOUCH_INTERVAL_MS), true);
  assert.ok(TOUCH_INTERVAL_MS * 2 < IDLE_LIMIT_MS);
});
