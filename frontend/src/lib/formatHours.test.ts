// Unit tests for the shared public open/closed pill copy. Run with Node's
// built-in runner:   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { describeOpenStatus, formatShortTime } from "./formatHours.ts";

test("formatShortTime is compact 12-hour", () => {
  assert.equal(formatShortTime("10:00:00"), "10am");
  assert.equal(formatShortTime("22:00:00"), "10pm");
  assert.equal(formatShortTime("21:30:00"), "9:30pm");
  assert.equal(formatShortTime("00:00:00"), "12am");
  assert.equal(formatShortTime("12:00:00"), "12pm");
});

test("open now within today's window", () => {
  assert.deepEqual(
    describeOpenStatus({
      isOpenNow: true,
      isClosedToday: false,
      openTime: "10:00:00",
      closeTime: "22:00:00",
      opensLaterToday: null,
    }),
    { text: "Open now · until 10pm", tone: "open" },
  );
});

test("open now without known close time is a bare 'Open now'", () => {
  assert.deepEqual(describeOpenStatus({ isOpenNow: true }), { text: "Open now", tone: "open" });
});

test("before opening: closed now, opens later today", () => {
  assert.deepEqual(
    describeOpenStatus({
      isOpenNow: false,
      isClosedToday: false,
      openTime: "10:00:00",
      closeTime: "22:00:00",
      opensLaterToday: true,
    }),
    { text: "Closed now · opens 10am", tone: "opens_later" },
  );
});

test("after closing: just 'Closed now' (never 'Closed today')", () => {
  const label = describeOpenStatus({
    isOpenNow: false,
    isClosedToday: false,
    openTime: "10:00:00",
    closeTime: "22:00:00",
    opensLaterToday: false,
  });
  assert.deepEqual(label, { text: "Closed now", tone: "closed" });
});

test("closed now with phase unknown (older API) shows today's window", () => {
  assert.deepEqual(
    describeOpenStatus({
      isOpenNow: false,
      isClosedToday: false,
      openTime: "10:00:00",
      closeTime: "22:00:00",
    }),
    { text: "Closed now · today 10am–10pm", tone: "closed" },
  );
});

test("closed the entire day is the only 'Closed today'", () => {
  assert.deepEqual(describeOpenStatus({ isOpenNow: false, isClosedToday: true }), {
    text: "Closed today",
    tone: "closed",
  });
});

test("overnight hours: open until after midnight, and closed now between close and open", () => {
  assert.deepEqual(
    describeOpenStatus({
      isOpenNow: true,
      isClosedToday: false,
      openTime: "18:00:00",
      closeTime: "02:00:00",
    }),
    { text: "Open now · until 2am", tone: "open" },
  );
  assert.deepEqual(
    describeOpenStatus({
      isOpenNow: false,
      isClosedToday: false,
      openTime: "18:00:00",
      closeTime: "02:00:00",
      opensLaterToday: true,
    }),
    { text: "Closed now · opens 6pm", tone: "opens_later" },
  );
});

test("unknown hours render nothing", () => {
  assert.equal(describeOpenStatus({ isOpenNow: null }), null);
  assert.equal(describeOpenStatus({ isOpenNow: undefined }), null);
  assert.equal(describeOpenStatus({ isOpenNow: null, isClosedToday: null }), null);
});

test("plain isOpenNow=false with no hours is 'Closed now'", () => {
  assert.deepEqual(describeOpenStatus({ isOpenNow: false }), { text: "Closed now", tone: "closed" });
});
