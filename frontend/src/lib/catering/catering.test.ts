// Unit tests for the catering pure-logic modules.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import { centsToInput, parseQuoteAmount } from "./quoteForm.ts";
import {
  buildRequestPayload,
  canAddItem,
  canRemoveItem,
  emptyDraft,
  isValid,
  validateDraft,
  type RequestDraft,
} from "./requestForm.ts";
import {
  canContinue,
  clampSelection,
  isRowDisabled,
  selectionCounter,
  toggleSelection,
} from "./selection.ts";
import {
  contactRevealed,
  formatCents,
  formatEventDate,
  itemCountLabel,
  itemLine,
  quoteProgress,
  quotesCheapestFirst,
  recipientStatusLabel,
  requesterLabel,
  requestStatusLabel,
  sizeLabel,
  SIZE_OPTIONS,
} from "./summary.ts";

const TODAY = "2026-11-13";

function validDraft(): RequestDraft {
  return {
    ...emptyDraft("k1"),
    event_date: "2026-11-21",
    headcount: "50",
    delivery_or_pickup: "pickup",
    items: [{ key: "k1", item_name: " Chicken biryani ", size: "full_tray", quantity: "2", note: "" }],
  };
}

// --- sizes / labels --------------------------------------------------------
test("size options are exactly full, medium, flat tray plus other", () => {
  assert.deepEqual(
    SIZE_OPTIONS.map((s) => s.value),
    ["full_tray", "medium_tray", "flat_tray", "other"]
  );
  assert.equal(sizeLabel("full_tray"), "Full tray");
  assert.equal(sizeLabel("medium_tray"), "Medium tray");
  assert.equal(sizeLabel("flat_tray"), "Flat tray");
  assert.equal(sizeLabel("other"), "Other");
});

test("labels for statuses and requester", () => {
  assert.equal(recipientStatusLabel("pending"), "Waiting for a quote");
  assert.equal(recipientStatusLabel("quoted"), "Quote received");
  assert.equal(recipientStatusLabel("declined"), "Declined");
  assert.equal(recipientStatusLabel("expired"), "No response");
  assert.equal(requestStatusLabel("open"), "Open");
  assert.equal(requestStatusLabel("closed"), "Expired");
  assert.equal(requestStatusLabel("cancelled"), "Cancelled");
  assert.equal(requesterLabel("Priya"), "Priya");
  assert.equal(requesterLabel("  "), "A diner");
  assert.equal(requesterLabel(null), "A diner");
});

test("money and dates format without drifting", () => {
  assert.equal(formatCents(45050), "$450.50");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(100_000_000), "$1,000,000.00");
  // A date-only value must never shift a day by timezone.
  assert.equal(formatEventDate("2026-11-21"), "Sat, Nov 21, 2026");
  assert.equal(formatEventDate("not a date"), "not a date");
});

test("item lines and counts", () => {
  assert.equal(
    itemLine({ item_name: "Paneer tikka", size: "medium_tray", quantity: 2 }),
    "2 × Paneer tikka (Medium tray)"
  );
  assert.equal(itemCountLabel(1), "1 item");
  assert.equal(itemCountLabel(3), "3 items");
});

test("quote progress and cheapest-first ordering ignore non-quotes", () => {
  const rows = [
    { status: "quoted" as const, quote_amount_cents: 9000 },
    { status: "pending" as const, quote_amount_cents: null },
    { status: "quoted" as const, quote_amount_cents: 5000 },
    { status: "declined" as const, quote_amount_cents: null },
  ];
  assert.equal(quoteProgress(rows), "2 of 4 restaurants have quoted");
  assert.equal(quoteProgress([rows[0]]), "1 of 1 restaurant has quoted");
  assert.deepEqual(
    quotesCheapestFirst(rows).map((r) => r.quote_amount_cents),
    [5000, 9000]
  );
});

test("contact is revealed only when the API sent it", () => {
  assert.equal(contactRevealed({ requester_email: null, requester_phone: null }), false);
  assert.equal(contactRevealed({ requester_email: "a@b.co", requester_phone: null }), true);
});

// --- selection cap ---------------------------------------------------------
test("toggleSelection adds up to the cap, then refuses", () => {
  let sel: number[] = [];
  for (const id of [1, 2, 3]) sel = toggleSelection(sel, id, 3).selected;
  assert.deepEqual(sel, [1, 2, 3]);
  const refused = toggleSelection(sel, 4, 3);
  assert.equal(refused.atCap, true);
  assert.deepEqual(refused.selected, [1, 2, 3]);
});

test("toggleSelection removes a selected id even at the cap, without mutating input", () => {
  const sel = [1, 2, 3];
  const next = toggleSelection(sel, 2, 3);
  assert.deepEqual(next.selected, [1, 3]);
  assert.equal(next.atCap, false);
  assert.deepEqual(sel, [1, 2, 3]);
});

test("cap follows the API value (not a hardcoded 5)", () => {
  assert.equal(toggleSelection([1, 2, 3, 4, 5], 6, 8).atCap, false);
  assert.equal(toggleSelection([1, 2], 3, 2).atCap, true);
});

test("counter, row disabling, clamp and continue rules", () => {
  assert.equal(selectionCounter(3, 5), "3 of 5 selected");
  assert.equal(isRowDisabled([1, 2], 3, 2), true);
  assert.equal(isRowDisabled([1, 2], 2, 2), false); // a selected row stays tappable
  assert.equal(isRowDisabled([1], 3, 2), false);
  assert.deepEqual(clampSelection([1, 2, 3, 4], 2), [1, 2]);
  assert.deepEqual(clampSelection([1], 5), [1]);
  assert.equal(canContinue([], 5), false);
  assert.equal(canContinue([1], 5), true);
  assert.equal(canContinue([1, 2, 3], 2), false);
});

// --- request form ----------------------------------------------------------
test("a complete draft validates", () => {
  assert.equal(isValid(validateDraft(validDraft(), TODAY)), true);
});

test("an empty draft reports every required field", () => {
  const errors = validateDraft(emptyDraft("k"), TODAY);
  for (const field of [
    "event_date",
    "headcount",
    "delivery_or_pickup",
    "items.0.item_name",
    "items.0.size",
  ]) {
    assert.ok(errors[field], `expected an error for ${field}`);
  }
});

test("event date: valid, not in the past, real calendar day", () => {
  const d = validDraft();
  assert.equal(validateDraft({ ...d, event_date: TODAY }, TODAY).event_date, undefined);
  assert.ok(validateDraft({ ...d, event_date: "2026-11-12" }, TODAY).event_date);
  assert.ok(validateDraft({ ...d, event_date: "2026-02-30" }, TODAY).event_date);
  assert.ok(validateDraft({ ...d, event_date: "" }, TODAY).event_date);
});

test("headcount bounds 1..5000, whole numbers only", () => {
  const d = validDraft();
  for (const bad of ["0", "5001", "-3", "2.5", "abc", ""]) {
    assert.ok(validateDraft({ ...d, headcount: bad }, TODAY).headcount, bad);
  }
  for (const good of ["1", "5000", " 40 "]) {
    assert.equal(validateDraft({ ...d, headcount: good }, TODAY).headcount, undefined, good);
  }
});

test("delivery needs a city or ZIP; pickup does not; ZIP and phone shape", () => {
  const d = validDraft();
  assert.ok(validateDraft({ ...d, delivery_or_pickup: "delivery" }, TODAY).delivery_city);
  assert.equal(
    validateDraft({ ...d, delivery_or_pickup: "delivery", delivery_zip: "75038" }, TODAY).delivery_city,
    undefined
  );
  assert.ok(validateDraft({ ...d, delivery_zip: "7503" }, TODAY).delivery_zip);
  assert.ok(validateDraft({ ...d, requester_phone: "12345" }, TODAY).requester_phone);
  assert.equal(validateDraft({ ...d, requester_phone: "(214) 555-0142" }, TODAY).requester_phone, undefined);
});

test("item rules: name, size, quantity 1..100, count 1..30", () => {
  const d = validDraft();
  const item = d.items[0];
  assert.ok(validateDraft({ ...d, items: [{ ...item, item_name: "  " }] }, TODAY)["items.0.item_name"]);
  assert.ok(validateDraft({ ...d, items: [{ ...item, size: "" }] }, TODAY)["items.0.size"]);
  for (const bad of ["0", "101", "1.5", ""]) {
    assert.ok(validateDraft({ ...d, items: [{ ...item, quantity: bad }] }, TODAY)["items.0.quantity"], bad);
  }
  assert.ok(validateDraft({ ...d, items: [] }, TODAY).items);
  const many = Array.from({ length: 31 }, (_, i) => ({ ...item, key: `k${i}` }));
  assert.ok(validateDraft({ ...d, items: many }, TODAY).items);
  assert.equal(canAddItem(29), true);
  assert.equal(canAddItem(30), false);
  assert.equal(canRemoveItem(1), false);
  assert.equal(canRemoveItem(2), true);
});

test("payload is trimmed, numeric, and drops delivery fields for pickup", () => {
  const d: RequestDraft = {
    ...validDraft(),
    delivery_or_pickup: "pickup",
    delivery_city: "Irving",
    delivery_zip: "75038",
    notes: "  ",
    requester_phone: " 2145550142 ",
  };
  const payload = buildRequestPayload(d, [4, 9]);
  assert.deepEqual(payload, {
    event_date: "2026-11-21",
    headcount: 50,
    delivery_or_pickup: "pickup",
    delivery_city: null,
    delivery_zip: null,
    requester_phone: "2145550142",
    notes: null,
    items: [{ item_name: "Chicken biryani", size: "full_tray", quantity: 2, note: null }],
    location_ids: [4, 9],
  });
  const delivery = buildRequestPayload({ ...d, delivery_or_pickup: "delivery" }, [1]);
  assert.equal(delivery.delivery_city, "Irving");
  assert.equal(delivery.delivery_zip, "75038");
});

// --- quote amount ----------------------------------------------------------
test("quote amounts parse to exact cents", () => {
  assert.deepEqual(parseQuoteAmount("450"), { ok: true, cents: 45000, amount: "450.00" });
  assert.deepEqual(parseQuoteAmount("450.5"), { ok: true, cents: 45050, amount: "450.50" });
  assert.deepEqual(parseQuoteAmount("$1,200.10"), { ok: true, cents: 120010, amount: "1200.10" });
  assert.deepEqual(parseQuoteAmount("0.01"), { ok: true, cents: 1, amount: "0.01" });
  assert.deepEqual(parseQuoteAmount("1000000"), { ok: true, cents: 100_000_000, amount: "1000000.00" });
  assert.deepEqual(parseQuoteAmount("007"), { ok: true, cents: 700, amount: "7.00" });
});

test("quote amounts reject zero, negatives, too many decimals, over the cap, junk", () => {
  for (const bad of ["", "0", "0.00", "-5", "12.345", "1000000.01", "10000000", "abc", "1e5"]) {
    assert.equal(parseQuoteAmount(bad).ok, false, bad);
  }
  assert.equal(centsToInput(45050), "450.50");
  assert.equal(centsToInput(5), "0.05");
});
