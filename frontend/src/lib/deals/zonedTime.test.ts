// Wall-clock <-> instant conversion for deal times.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { isoToWallClock, safeTimeZone, toApiDateTime, wallClockToIso } from "./zonedTime.ts";

const CHICAGO = "America/Chicago";

test("a time typed for a Texas restaurant is that time in Texas, summer and winter", () => {
  assert.equal(wallClockToIso("2026-11-24T00:00", CHICAGO), "2026-11-24T06:00:00.000Z");
  assert.equal(wallClockToIso("2026-07-04T00:00", CHICAGO), "2026-07-04T05:00:00.000Z");
  assert.equal(wallClockToIso("2026-11-24T00:00", "America/Los_Angeles"), "2026-11-24T08:00:00.000Z");
  assert.equal(wallClockToIso("2026-11-24T10:00", "Asia/Kolkata"), "2026-11-24T04:30:00.000Z");
});

test("the result does not depend on the machine's own time zone", () => {
  const original = process.env.TZ;
  try {
    for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      assert.equal(wallClockToIso("2026-11-25T10:00", CHICAGO), "2026-11-25T16:00:00.000Z");
      assert.equal(isoToWallClock("2026-11-25T16:00:00Z", CHICAGO), "2026-11-25T10:00");
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("saving unchanged many times never drifts", () => {
  let wall = "2026-11-30T22:00";
  for (let i = 0; i < 5; i += 1) {
    const iso = wallClockToIso(wall, CHICAGO);
    assert.ok(iso);
    wall = isoToWallClock(iso, CHICAGO);
  }
  assert.equal(wall, "2026-11-30T22:00");
});

test("clock changes: repeated time takes the earlier one, skipped time moves forward", () => {
  // 2026-11-01 01:30 happens twice in Chicago; 2026-03-08 02:30 never happens.
  assert.equal(wallClockToIso("2026-11-01T01:30", CHICAGO), "2026-11-01T06:30:00.000Z");
  const skipped = wallClockToIso("2026-03-08T02:30", CHICAGO);
  assert.equal(skipped, "2026-03-08T08:30:00.000Z");
  assert.equal(isoToWallClock(skipped, CHICAGO), "2026-03-08T03:30");
  assert.equal(wallClockToIso("2026-03-08T03:00", CHICAGO), "2026-03-08T08:00:00.000Z");
});

test("invalid input is not turned into a date", () => {
  for (const bad of ["", "not a date", "2026-02-30T10:00", "2026-13-01T10:00", "2026-09-25T24:00", "2026-09-25T10:75", "2026-09-25"]) {
    assert.equal(wallClockToIso(bad, CHICAGO), null, bad);
  }
  assert.equal(toApiDateTime("", CHICAGO), "");
  assert.equal(toApiDateTime("junk", CHICAGO), "junk");
  assert.equal(isoToWallClock(null, CHICAGO), "");
  assert.equal(isoToWallClock("junk", CHICAGO), "");
});

test("an unknown time zone falls back to the platform default", () => {
  assert.equal(safeTimeZone("Not/AZone"), CHICAGO);
  assert.equal(safeTimeZone(""), CHICAGO);
  assert.equal(safeTimeZone("America/Denver"), "America/Denver");
  assert.equal(wallClockToIso("2026-11-24T00:00", "Not/AZone"), "2026-11-24T06:00:00.000Z");
});
