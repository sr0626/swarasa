import assert from "node:assert/strict";
import test from "node:test";
import {
  countHidden,
  hiddenSummary,
  withItemHidden,
  withSectionHidden,
} from "./visibility.ts";

const item = (id: number, is_hidden = false) => ({ id, is_hidden, name: `item ${id}` });
const menu = () => ({
  menu_hidden: false,
  ungrouped_items: [item(1), item(2, true)],
  sections: [
    { id: 10, is_hidden: false, items: [item(3), item(4)] },
    { id: 11, is_hidden: true, items: [item(5, true)] },
  ],
});

test("withItemHidden flips one ungrouped item without mutating the input", () => {
  const before = menu();
  const after = withItemHidden(before, 1, true);
  assert.equal(after.ungrouped_items[0]?.is_hidden, true);
  assert.equal(before.ungrouped_items[0]?.is_hidden, false);
  assert.equal(after.ungrouped_items[1]?.is_hidden, true);
  assert.equal(after.ungrouped_items[0]?.name, "item 1");
});

test("withItemHidden reaches items inside groups", () => {
  const after = withItemHidden(menu(), 4, true);
  assert.deepEqual(
    after.sections[0]?.items.map((i) => i.is_hidden),
    [false, true]
  );
  const shown = withItemHidden(after, 4, false);
  assert.equal(shown.sections[0]?.items[1]?.is_hidden, false);
});

test("withSectionHidden leaves the group's items' own flags alone", () => {
  const after = withSectionHidden(menu(), 10, true);
  assert.equal(after.sections[0]?.is_hidden, true);
  assert.deepEqual(
    after.sections[0]?.items.map((i) => i.is_hidden),
    [false, false]
  );
  assert.equal(after.sections[1]?.is_hidden, true);
});

test("countHidden counts hidden items and groups", () => {
  assert.deepEqual(countHidden(menu()), { items: 2, sections: 1 });
  assert.deepEqual(
    countHidden({ menu_hidden: false, ungrouped_items: [], sections: [] }),
    { items: 0, sections: 0 }
  );
});

test("hiddenSummary pluralises and is empty when nothing is hidden", () => {
  assert.equal(hiddenSummary({ items: 0, sections: 0 }), "");
  assert.equal(hiddenSummary({ items: 1, sections: 0 }), "1 hidden item");
  assert.equal(hiddenSummary({ items: 2, sections: 1 }), "2 hidden items and 1 hidden group");
  assert.equal(hiddenSummary({ items: 0, sections: 3 }), "3 hidden groups");
});
