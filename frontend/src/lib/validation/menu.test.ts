// Unit tests for the menu form/schemas — mirrors backend/app/schemas/menu.py.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  createMenuItemSchema,
  MENU_LIMITS,
  menuSectionSchema,
  NAME_REQUIRED_MESSAGE,
  PRICE_REQUIRED_MESSAGE,
  SIZE_LABEL_REQUIRED_MESSAGE,
  SIZE_PRICE_REQUIRED_MESSAGE,
  SIZES_REQUIRED_MESSAGE,
  updateMenuItemSchema,
  validateMenuItemForm,
  type MenuItemFormState,
} from "./menu.ts";

const single: MenuItemFormState = {
  name: "  Chicken Biryani ",
  description: "  ",
  priceMode: "single",
  price: " Market price ",
  sizes: [],
  section_id: null,
};

test("single price: name/price are trimmed, free text is kept as-is, blank description -> null", () => {
  const result = validateMenuItemForm(single);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    name: "Chicken Biryani",
    description: null,
    price: "Market price",
    sizes: null,
    section_id: null,
  });
});

test("single price mode never sends the sizes typed earlier (mode decides the payload)", () => {
  const result = validateMenuItemForm({
    ...single,
    sizes: [{ label: "Half", price: "$5" }],
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.sizes, null);
});

test("name and price are mandatory after trim", () => {
  const result = validateMenuItemForm({ ...single, name: "   ", price: "  " });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.name, NAME_REQUIRED_MESSAGE);
  assert.equal(result.errors.price, PRICE_REQUIRED_MESSAGE);
});

test("length caps: name 150, price 50, description 1000", () => {
  const result = validateMenuItemForm({
    ...single,
    name: "n".repeat(MENU_LIMITS.itemName + 1),
    price: "p".repeat(MENU_LIMITS.price + 1),
    description: "d".repeat(MENU_LIMITS.itemDescription + 1),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.name ?? "", /at most 150/);
  assert.match(result.errors.price ?? "", /at most 50/);
  assert.match(result.errors.description ?? "", /at most 1000/);
});

const sized: MenuItemFormState = {
  ...single,
  priceMode: "sizes",
  price: "$99", // stale single price must be ignored in sizes mode
  sizes: [
    { label: " Personal ", price: " $10 " },
    { label: "Double", price: "$15" },
    { label: "Family Pack", price: "$25" },
  ],
};

test("sizes mode: trims rows, keeps order, drops the single price", () => {
  const result = validateMenuItemForm(sized);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.price, null);
  assert.deepEqual(result.value.sizes, [
    { label: "Personal", price: "$10" },
    { label: "Double", price: "$15" },
    { label: "Family Pack", price: "$25" },
  ]);
});

test("sizes mode: missing label / price are reported on the offending row", () => {
  const result = validateMenuItemForm({
    ...sized,
    sizes: [
      { label: "Personal", price: "$10" },
      { label: "  ", price: "$15" },
      { label: "Family Pack", price: "" },
    ],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.errors.sizeRows[0], {});
  assert.equal(result.errors.sizeRows[1].label, SIZE_LABEL_REQUIRED_MESSAGE);
  assert.equal(result.errors.sizeRows[1].price, undefined);
  assert.equal(result.errors.sizeRows[2].price, SIZE_PRICE_REQUIRED_MESSAGE);
});

test("sizes mode: an empty list is rejected with a list-level message", () => {
  const result = validateMenuItemForm({ ...sized, sizes: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.sizes, SIZES_REQUIRED_MESSAGE);
});

test("sizes mode: more than 6 sizes is rejected; exactly 6 is fine", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `S${i}`, price: "$1" }));
  assert.equal(validateMenuItemForm({ ...sized, sizes: rows(6) }).ok, true);
  const tooMany = validateMenuItemForm({ ...sized, sizes: rows(7) });
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.match(tooMany.errors.sizes ?? "", /at most 6/);
});

test("size label and price length caps", () => {
  const result = validateMenuItemForm({
    ...sized,
    sizes: [{ label: "l".repeat(41), price: "p".repeat(51) }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.sizeRows[0].label ?? "", /at most 40/);
  assert.match(result.errors.sizeRows[0].price ?? "", /at most 50/);
});

test("API-input schema: both price and sizes -> rejected; neither -> rejected", () => {
  const both = createMenuItemSchema.safeParse({
    name: "Dish",
    price: "$1",
    sizes: [{ label: "A", price: "$1" }],
  });
  assert.equal(both.success, false);
  const neither = createMenuItemSchema.safeParse({ name: "Dish" });
  assert.equal(neither.success, false);
});

test("PATCH schema: partial is fine, both forms at once is not", () => {
  assert.equal(updateMenuItemSchema.safeParse({ name: "Renamed" }).success, true);
  assert.equal(updateMenuItemSchema.safeParse({ section_id: 4 }).success, true);
  assert.equal(
    updateMenuItemSchema.safeParse({ price: "$1", sizes: [{ label: "A", price: "$1" }] }).success,
    false
  );
});

test("section: name mandatory, description optional/trimmed, caps enforced", () => {
  assert.equal(menuSectionSchema.safeParse({ name: "  ", description: "" }).success, false);
  const ok = menuSectionSchema.parse({ name: " Appetizers ", description: "  " });
  assert.deepEqual(ok, { name: "Appetizers", description: null });
  assert.equal(menuSectionSchema.safeParse({ name: "n".repeat(101), description: "" }).success, false);
  assert.equal(
    menuSectionSchema.safeParse({ name: "ok", description: "d".repeat(501) }).success,
    false
  );
});
