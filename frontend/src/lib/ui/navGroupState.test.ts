// Unit tests for the grouped-menu state logic.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultOpenGroupIds,
  navGroupStorageKey,
  parseStoredGroupState,
  resolveOpenGroups,
  resolveSelectedGroupId,
} from "./navGroupState.ts";

// Same order as the admin menu: Listings (default open), People, Work queue, System.
const groups = [
  { id: "listings", defaultOpen: true },
  { id: "people" },
  { id: "work-queue" },
  { id: "system" },
];

test("defaults: only the defaultOpen group (Listings) is open when the page is in no group", () => {
  assert.deepEqual([...defaultOpenGroupIds(groups, null)], ["listings"]);
});

test("defaults: the group holding the active page is open too", () => {
  assert.deepEqual([...defaultOpenGroupIds(groups, "people")].sort(), ["listings", "people"]);
  assert.deepEqual([...defaultOpenGroupIds(groups, "work-queue")].sort(), ["listings", "work-queue"]);
});

test("storage key is stable, per menu and lower-case", () => {
  assert.equal(navGroupStorageKey("Admin"), "swarasa.consoleNav.admin.groups");
  assert.equal(navGroupStorageKey(" Business Owner "), "swarasa.consoleNav.business-owner.groups");
});

test("resolveOpenGroups with nothing stored matches the defaults (what SSR renders)", () => {
  assert.deepEqual(resolveOpenGroups(groups, "work-queue"), {
    listings: true,
    people: false,
    "work-queue": true,
    system: false,
  });
  assert.deepEqual(resolveOpenGroups(groups, null), {
    listings: true,
    people: false,
    "work-queue": false,
    system: false,
  });
});

test("stored choices override defaults but not the active group", () => {
  const out = resolveOpenGroups(groups, "people", { listings: false, "work-queue": true, people: false });
  assert.deepEqual(out, { listings: false, people: true, "work-queue": true, system: false });
});

test("parseStoredGroupState tolerates null, junk, wrong shapes and unknown ids", () => {
  assert.deepEqual(parseStoredGroupState(null, groups), {});
  assert.deepEqual(parseStoredGroupState("", groups), {});
  assert.deepEqual(parseStoredGroupState("{not json", groups), {});
  assert.deepEqual(parseStoredGroupState("[true]", groups), {});
  assert.deepEqual(parseStoredGroupState("null", groups), {});
  assert.deepEqual(
    parseStoredGroupState('{"people":true,"system":"yes","gone":true,"listings":false}', groups),
    { people: true, listings: false }
  );
});

test("selected group: pick wins, then the active page's group, then default (Listings)/first", () => {
  assert.equal(resolveSelectedGroupId(groups, "people", "system"), "system");
  assert.equal(resolveSelectedGroupId(groups, "people", null), "people");
  assert.equal(resolveSelectedGroupId(groups, null, null), "listings");
  assert.equal(resolveSelectedGroupId([{ id: "a" }, { id: "b" }], null, null), "a");
  assert.equal(resolveSelectedGroupId(groups, "people", "unknown"), "people");
  assert.equal(resolveSelectedGroupId([], null, null), null);
});
