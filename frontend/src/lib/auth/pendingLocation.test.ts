//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { savePendingLocation, takePendingLocation, type PendingStorage } from "./pendingLocation.ts";

function fakeStorage(): PendingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test("round-trips for the same email (case-insensitive) and clears itself", () => {
  const s = fakeStorage();
  savePendingLocation("Asha@Example.com ", { city: "Plano", postal_code: "75093" }, s);
  assert.deepEqual(takePendingLocation("asha@example.com", s), {
    city: "Plano",
    postal_code: "75093",
  });
  assert.equal(takePendingLocation("asha@example.com", s), null);
  assert.equal(s.data.size, 0);
});

test("never hands one person's parked location to a different email", () => {
  const s = fakeStorage();
  savePendingLocation("a@example.com", { city: "Plano", postal_code: "75093" }, s);
  assert.equal(takePendingLocation("b@example.com", s), null);
  assert.equal(s.data.size, 1); // left for its owner
});

test("returns null for corrupt or invalid parked data and with no storage", () => {
  const s = fakeStorage();
  s.setItem("swarasa.pendingLocation", "{not json");
  assert.equal(takePendingLocation("a@example.com", s), null);
  s.setItem(
    "swarasa.pendingLocation",
    JSON.stringify({ email: "a@example.com", city: "P", postal_code: "x" })
  );
  assert.equal(takePendingLocation("a@example.com", s), null);
  assert.equal(takePendingLocation("a@example.com", null), null);
});
