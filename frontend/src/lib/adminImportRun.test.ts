// Unit tests for the chunk runner and the bounded geocoder pass.  cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { geocodeRows, runChunks, type SendResult } from "./adminImportRun.ts";
import type { CommittedRow, ImportRowInput } from "../types/adminImport.ts";

const row = (n: number, over: Partial<ImportRowInput> = {}): ImportRowInput => ({
  row_number: n,
  name: `R${n}`,
  address_line1: `${n} Main St`,
  city: "Plano",
  state: "TX",
  postal_code: "75024",
  ...over,
});
const created = (r: ImportRowInput): CommittedRow => ({
  row_number: r.row_number,
  name: r.name ?? "",
  result: "created",
  reason: null,
  brand_id: 1,
  location_id: 1,
  needs_geocoding: false,
  listing_status: null,
  missing: [],
});

test("runChunks sends sequentially, reports progress and collects results", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const progress: number[] = [];
  const send = async (c: ImportRowInput[]): Promise<SendResult> => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return { ok: true, rows: c.map(created) };
  };
  const state = await runChunks([[row(2), row(3)], [row(4)]], send, { onProgress: (d) => progress.push(d) });
  assert.equal(state.stopped, "done");
  assert.equal(maxInFlight, 1);
  assert.deepEqual(progress, [1, 2]);
  assert.equal(state.results.length, 3);
  assert.equal(state.remaining.length, 0);
});

test("runChunks stops at the first failed chunk and can resume from it", async () => {
  const chunks = [[row(2)], [row(3)], [row(4)]];
  let calls = 0;
  const flaky = async (c: ImportRowInput[]): Promise<SendResult> => {
    calls++;
    return calls === 2 ? { ok: false, error: "timeout" } : { ok: true, rows: c.map(created) };
  };
  const first = await runChunks(chunks, flaky);
  assert.equal(first.stopped, "error");
  assert.equal(first.error, "timeout");
  assert.equal(first.results.length, 1);
  assert.deepEqual(
    first.remaining.map((c) => c[0]?.row_number),
    [3, 4]
  );

  const resumed = await runChunks(first.remaining, flaky, {}, first.results);
  assert.equal(resumed.stopped, "done");
  assert.equal(resumed.results.length, 3);
});

test("runChunks turns a thrown send into a stop, and honours shouldStop between chunks", async () => {
  const thrower = async (): Promise<SendResult> => {
    throw new Error("boom");
  };
  const a = await runChunks([[row(2)]], thrower);
  assert.equal(a.stopped, "error");
  assert.equal(a.remaining.length, 1);

  let stop = false;
  const b = await runChunks(
    [[row(2)], [row(3)]],
    async (c) => {
      stop = true;
      return { ok: true, rows: c.map(created) };
    },
    { shouldStop: () => stop }
  );
  assert.equal(b.stopped, "user");
  assert.equal(b.results.length, 1);
  assert.equal(b.remaining.length, 1);
});

test("geocodeRows fills missing coordinates, leaves given and failed rows alone, keeps order", async () => {
  const rows = [row(2), row(3, { latitude: "33.1", longitude: "-96.8" }), row(4), row(5, { address_line1: null })];
  const { rows: out, geocoded } = await geocodeRows(
    rows,
    async (r) => (r.row_number === 4 ? null : { latitude: 33.0, longitude: -96.7 }),
    { concurrency: 3, deadlineMs: 1000, now: Date.now }
  );
  assert.equal(geocoded, 1);
  assert.deepEqual(
    out.map((r) => r.row_number),
    [2, 3, 4, 5]
  );
  assert.equal(out[0]?.latitude, 33.0);
  assert.equal(out[1]?.latitude, "33.1");
  assert.equal(out[2]?.latitude, undefined);
  assert.equal(out[3]?.latitude, undefined);
  assert.equal(rows[0]?.latitude, undefined, "input is not mutated");
});

test("geocodeRows respects the deadline and never throws on a geocoder error", async () => {
  let t = 0;
  const now = () => t;
  const out = await geocodeRows(
    [row(2), row(3), row(4)],
    async () => {
      t += 600;
      return { latitude: 1, longitude: 2 };
    },
    { concurrency: 1, deadlineMs: 1000, now }
  );
  assert.equal(out.geocoded, 2, "third lookup not started after the deadline");

  const err = await geocodeRows(
    [row(2)],
    async () => {
      throw new Error("x");
    },
    { concurrency: 2, deadlineMs: 1000, now: Date.now }
  );
  assert.equal(err.geocoded, 0);
});
