// Run with Node's built-in runner:   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_CELL, toActivityRows as toRows } from "./ownerFeedRows.ts";
import { formatZonedDateTime } from "../format/zonedDateTime.ts";
import type { OwnerActivity } from "../../types/activity.ts";

const toActivityRows = (events: OwnerActivity[]) => toRows(events, formatZonedDateTime);

function event(overrides: Partial<OwnerActivity> = {}): OwnerActivity {
  return {
    id: 7,
    table_name: "restaurant_location",
    action: "update",
    actor_role: "owner",
    actor_label: "You",
    actor_resolved: true,
    summary: "Location status updated",
    created_at: "2026-09-25T03:45:00Z",
    restaurant_name: "Spice Route",
    location_name: "Plano",
    timezone: "America/Chicago",
    actor_email: "owner@example.com",
    actor_role_label: "Owner",
    changes: [{ field: "status", label: "Status", old: "Live", new: "Hidden" }],
    ...overrides,
  };
}

test("a status change is one row with friendly old/new and a zoned time", () => {
  const [row, ...rest] = toActivityRows([event()]);
  assert.equal(rest.length, 0);
  assert.deepEqual(row, {
    key: "7-0",
    when: "Sep 24, 2026, 10:45 PM CDT",
    restaurant: "Spice Route",
    location: "Plano",
    what: "Status",
    previous: "Live",
    next: "Hidden",
    updatedBy: "You",
    updatedByRole: "Owner",
    action: "update",
  });
});

test("one row per changed field, meta repeated, keys unique", () => {
  const rows = toActivityRows([
    event({
      changes: [
        { field: "hours.0", label: "Hours (Monday)", old: "11am–9pm", new: "10am–10pm" },
        { field: "hours.1", label: "Hours (Tuesday)", old: null, new: "Closed" },
      ],
    }),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.key), ["7-0", "7-1"]);
  assert.deepEqual(rows.map((r) => r.what), ["Hours (Monday)", "Hours (Tuesday)"]);
  assert.equal(rows[1]?.previous, EMPTY_CELL);
  assert.equal(rows[1]?.when, rows[0]?.when);
});

test("an event with no field changes shows its summary with dashes", () => {
  const [row] = toActivityRows([
    event({ action: "create", summary: "Location added", changes: [] }),
  ]);
  assert.equal(row?.what, "Location added");
  assert.equal(row?.previous, EMPTY_CELL);
  assert.equal(row?.next, EMPTY_CELL);
});

test("an older API (no detail fields) degrades to a summary-only row", () => {
  const [row] = toActivityRows([
    {
      id: 1,
      table_name: "restaurant_brand",
      action: "update",
      actor_role: "manager",
      actor_label: "a manager",
      actor_resolved: false,
      summary: "Restaurant name updated",
      created_at: "2026-09-25T03:45:00Z",
    },
  ]);
  assert.equal(row?.what, "Restaurant name updated");
  assert.equal(row?.restaurant, EMPTY_CELL);
  assert.equal(row?.location, null);
  assert.equal(row?.updatedBy, "a manager");
  assert.equal(row?.updatedByRole, "");
  assert.equal(row?.when, "Sep 24, 2026, 10:45 PM CDT");
});

test("a brand-level event has no location", () => {
  const [row] = toActivityRows([event({ location_name: null, table_name: "restaurant_brand" })]);
  assert.equal(row?.location, null);
});

test("a manager/email actor keeps its own role label", () => {
  const [row] = toActivityRows([
    event({ actor_label: "mgr@example.com", actor_role: "manager", actor_role_label: "Manager" }),
  ]);
  assert.equal(row?.updatedBy, "mgr@example.com");
  assert.equal(row?.updatedByRole, "Manager");
});
