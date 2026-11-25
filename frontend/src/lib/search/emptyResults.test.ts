//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { emptyResultsBody } from "./emptyResults.ts";

test("a search by name that matches nothing says to check the name", () => {
  const body = emptyResultsBody({ filterCount: 0, openNow: false, query: "zzz" });
  assert.match(body, /couldn't find a restaurant matching that/);
});

test("an area with no restaurants and no search text keeps the 'listed yet' copy", () => {
  const body = emptyResultsBody({ filterCount: 0, openNow: false, query: "   " });
  assert.match(body, /No restaurants are listed here yet/);
});

test("filters explain themselves, including open-now, even with search text", () => {
  assert.match(emptyResultsBody({ filterCount: 2, openNow: false, query: "zzz" }), /all of these tags/);
  assert.match(emptyResultsBody({ filterCount: 1, openNow: true, query: "" }), /open right now/);
});
