// Unit tests for the menu JSON-LD builder + the safe serializer.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { buildMenuSchema, jsonLdString } from "./jsonld.ts";

const item = (name: string, description: string | null = null) => ({ name, description });

test("buildMenuSchema: nothing to publish -> undefined", () => {
  assert.equal(buildMenuSchema(null), undefined);
  assert.equal(buildMenuSchema({ ungrouped_items: [], sections: [] }), undefined);
  assert.equal(
    buildMenuSchema({
      ungrouped_items: [],
      sections: [{ name: "Empty group", description: null, items: [] }],
    }),
    undefined
  );
});

test("buildMenuSchema: sections + ungrouped items, name/description only (no prices)", () => {
  const menu = buildMenuSchema({
    ungrouped_items: [item("Chai", "Masala tea")],
    sections: [
      { name: "Appetizers", description: "Start here", items: [item("Samosa"), item("Pakora", "Crisp")] },
      { name: "Skipped", description: null, items: [] },
    ],
  });
  assert.deepEqual(menu, {
    "@type": "Menu",
    hasMenuItem: [{ "@type": "MenuItem", name: "Chai", description: "Masala tea" }],
    hasMenuSection: [
      {
        "@type": "MenuSection",
        name: "Appetizers",
        description: "Start here",
        hasMenuItem: [
          { "@type": "MenuItem", name: "Samosa" },
          { "@type": "MenuItem", name: "Pakora", description: "Crisp" },
        ],
      },
    ],
  });
  assert.equal(JSON.stringify(menu).includes("price"), false);
});

test("jsonLdString can never close the script tag early", () => {
  const lineSeparator = String.fromCharCode(0x2028);
  const value = { name: "</script><script>alert(1)</script>", d: `a${lineSeparator}b` };
  const out = jsonLdString(value);
  assert.equal(out.includes("<"), false);
  assert.equal(out.includes(lineSeparator), false);
  // Round-trips to the identical value.
  assert.deepEqual(JSON.parse(out), value);
});
