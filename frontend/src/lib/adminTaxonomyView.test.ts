// Unit tests for the admin taxonomy page helpers.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  deactivateConfirmText,
  filterTags,
  groupAdminTags,
  isDuplicateName,
  normalizeDisplayName,
  slugPreview,
  summarize,
  upsertTag,
  usageLabel,
  validateDisplayName,
} from "./adminTaxonomyView.ts";
import type { AdminTag } from "../types/adminTaxonomy.ts";

let nextId = 1;
function tag(over: Partial<AdminTag>): AdminTag {
  return {
    id: nextId++,
    name: "t",
    display_name: "T",
    category: "type",
    is_active: true,
    usage_count: 0,
    created_at: "2026-10-28T00:00:00Z",
    updated_at: "2026-10-28T00:00:00Z",
    ...over,
  };
}

test("display name validation mirrors the server", () => {
  assert.equal(validateDisplayName("   "), "Enter a name.");
  assert.equal(validateDisplayName("Food Truck"), null);
  assert.ok(validateDisplayName("x".repeat(121)));
  assert.equal(normalizeDisplayName("  Street   Food "), "Street Food");
});

test("slug preview matches the server derivation", () => {
  assert.equal(slugPreview("Street Food!"), "street_food");
  assert.equal(slugPreview("  Pop-up  Cart "), "pop_up_cart");
  assert.equal(slugPreview("!!!"), "");
});

test("duplicate detection is case-insensitive, per kind, and can ignore the tag being edited", () => {
  const a = tag({ category: "type", display_name: "Food Truck" });
  const b = tag({ category: "signature", display_name: "Biryani" });
  const all = [a, b];
  assert.equal(isDuplicateName(all, "type", "  food   TRUCK "), true);
  assert.equal(isDuplicateName(all, "dietary", "Food Truck"), false);
  assert.equal(isDuplicateName(all, "type", "Food Truck", a.id), false);
});

test("filterTags by state and by name or slug", () => {
  const on = tag({ name: "dosa", display_name: "Dosa" });
  const off = tag({ name: "old_thing", display_name: "Retired", is_active: false });
  assert.deepEqual(filterTags([on, off], "active", ""), [on]);
  assert.deepEqual(filterTags([on, off], "inactive", ""), [off]);
  assert.deepEqual(filterTags([on, off], "all", "OLD_"), [off]);
  assert.deepEqual(filterTags([on, off], "all", "dos"), [on]);
});

test("groupAdminTags orders kinds, sorts names, omits empty kinds", () => {
  const groups = groupAdminTags([
    tag({ category: "signature", display_name: "Chai" }),
    tag({ category: "regional", display_name: "Kerala" }),
    tag({ category: "regional", display_name: "Andhra" }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.category),
    ["regional", "signature"]
  );
  assert.deepEqual(
    groups[0].tags.map((t) => t.display_name),
    ["Andhra", "Kerala"]
  );
  assert.equal(groups[0].label, "Regional cuisine");
});

test("usage label and summary", () => {
  assert.equal(usageLabel(0), "Unused");
  assert.equal(usageLabel(1), "1 location");
  assert.equal(usageLabel(7), "7 locations");
  assert.deepEqual(summarize([tag({}), tag({ is_active: false })]), {
    total: 2,
    active: 1,
    inactive: 1,
  });
});

test("deactivate confirm text explains impact and reversibility", () => {
  const used = deactivateConfirmText({ display_name: "Food Truck", usage_count: 3 });
  assert.match(used, /Food Truck/);
  assert.match(used, /3 locations/);
  assert.match(used, /Nothing is deleted/);
  assert.match(deactivateConfirmText({ display_name: "X", usage_count: 0 }), /No locations use it/);
});

test("upsertTag replaces by id or appends", () => {
  const a = tag({ display_name: "A" });
  const renamed = { ...a, display_name: "A2" };
  assert.deepEqual(upsertTag([a], renamed), [renamed]);
  const b = tag({ display_name: "B" });
  assert.equal(upsertTag([a], b).length, 2);
});
