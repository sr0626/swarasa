// Unit tests for the picker's empty-state message selection.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { emptySearchMessage } from "./searchMessage.ts";

test("exactly one unavailable match: explicit singular message", () => {
  const m = emptySearchMessage({
    q: "spice",
    city: "",
    unavailable: [{ name: "Spice Route", city: "Irving" }],
  });
  assert.equal(m.kind, "single");
  assert.equal(m.headline, "Spice Route (Irving) isn't accepting catering requests.");
  assert.equal(m.kind === "single" && m.hint, "Try another restaurant.");
});

test("2-5 unavailable matches: plural message with the list", () => {
  const list = [
    { name: "A", city: "Irving" },
    { name: "B", city: "Plano" },
  ];
  const m = emptySearchMessage({ q: "x", city: "", unavailable: list });
  assert.equal(m.kind, "several");
  if (m.kind !== "several") return;
  assert.equal(
    m.headline,
    "These restaurants match your search but aren't accepting catering requests:"
  );
  assert.deepEqual(m.matches, list);
  assert.notEqual(m.matches, list, "returns a copy");
  assert.equal(m.hint, "Try another restaurant.");

  const five = Array.from({ length: 5 }, (_, i) => ({ name: `R${i}`, city: "Frisco" }));
  const m5 = emptySearchMessage({ q: "r", city: "", unavailable: five });
  assert.equal(m5.kind === "several" && m5.matches.length, 5);
});

test("no unavailable matches but a name and/or city typed: check the name and city", () => {
  const expected =
    "We couldn't find a restaurant matching that. Check the name and city and try again.";
  for (const [q, city] of [
    ["nothing", ""],
    ["", "Plano"],
    ["nothing", "Plano"],
    ["  x  ", "   "],
  ]) {
    const m = emptySearchMessage({ q, city, unavailable: [] });
    assert.equal(m.kind, "not_found", `${q}|${city}`);
    assert.equal(m.headline, expected);
  }
});

test("missing unavailable list (older API) behaves like an empty one", () => {
  assert.equal(emptySearchMessage({ q: "x", city: "", unavailable: undefined }).kind, "not_found");
  assert.equal(emptySearchMessage({ q: "x", city: "", unavailable: null }).kind, "not_found");
});

test("no search at all (empty or whitespace-only inputs): none-yet message", () => {
  for (const [q, city] of [
    ["", ""],
    ["   ", "\t "],
  ]) {
    const m = emptySearchMessage({ q, city, unavailable: [] });
    assert.equal(m.kind, "none_yet");
    assert.equal(
      m.headline,
      "No restaurants are accepting catering requests yet. Please check back soon."
    );
  }
});

test("unavailable matches win over the 'not found' wording", () => {
  const m = emptySearchMessage({ q: "", city: "", unavailable: [{ name: "Z", city: "Y" }] });
  assert.equal(m.kind, "single");
});
