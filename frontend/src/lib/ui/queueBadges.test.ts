// Unit tests for the admin Work queue badge logic.
//   cd frontend && npm run test:unit
import assert from "node:assert/strict";
import test from "node:test";
import {
  badgeText,
  buildAdminNavBadges,
  EMPTY_NAV_BADGES,
  groupAriaLabel,
  groupControlLabel,
  itemAriaLabel,
  normalizeQueueCounts,
} from "./queueBadges.ts";

const payload = {
  claims: { pending: 3, overdue: 1 },
  messages: { open: 2 },
  reports: { new: 0 },
  reopen_requests: { pending: 1 },
  total: 6,
};

test("badgeText: hidden at 0, literal to 99, capped as 99+", () => {
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(-4), null);
  assert.equal(badgeText(Number.NaN), null);
  assert.equal(badgeText(1), "1");
  assert.equal(badgeText(99), "99");
  assert.equal(badgeText(100), "99+");
  assert.equal(badgeText(12345), "99+");
  assert.equal(badgeText(7.9), "7");
});

test("normalizeQueueCounts derives total from the queues, ignoring the payload total", () => {
  const c = normalizeQueueCounts({ ...payload, total: 999 });
  assert.deepEqual(c, {
    claimsPending: 3,
    claimsOverdue: 1,
    messagesOpen: 2,
    reportsNew: 0,
    reopenPending: 1,
    total: 6,
  });
});

test("normalizeQueueCounts tolerates missing, partial and malformed input", () => {
  assert.equal(normalizeQueueCounts(null), null);
  assert.equal(normalizeQueueCounts(undefined), null);
  assert.equal(normalizeQueueCounts("nope"), null);
  assert.equal(normalizeQueueCounts({})?.total, 0);
  const partial = normalizeQueueCounts({ claims: { pending: "5" }, messages: { open: 4 }, reports: 7 });
  assert.equal(partial?.claimsPending, 0);
  assert.equal(partial?.messagesOpen, 4);
  assert.equal(partial?.reportsNew, 0);
  assert.equal(partial?.total, 4);
});

test("normalizeQueueCounts clamps overdue to pending", () => {
  assert.equal(normalizeQueueCounts({ claims: { pending: 2, overdue: 9 } })?.claimsOverdue, 2);
});

test("aria labels", () => {
  assert.equal(itemAriaLabel("Claims", 3, "pending", 1), "Claims, 3 pending, 1 overdue");
  assert.equal(itemAriaLabel("Claims", 3, "pending", 0), "Claims, 3 pending");
  assert.equal(itemAriaLabel("Messages", 2, "open"), "Messages, 2 open");
  assert.equal(groupAriaLabel("Work queue", 5), "Work queue, 5 need action");
  assert.equal(groupAriaLabel("Work queue", 1), "Work queue, 1 needs action");
});

test("buildAdminNavBadges: item badges, hidden when 0, group total and urgency", () => {
  const b = buildAdminNavBadges(normalizeQueueCounts(payload));
  assert.deepEqual(b.items["/admin/claims"], {
    text: "3",
    label: "Claims, 3 pending, 1 overdue",
    urgent: true,
  });
  assert.deepEqual(b.items["/admin/messages"], { text: "2", label: "Messages, 2 open", urgent: false });
  assert.equal(b.items["/admin/reports"], undefined); // 0 -> no badge
  assert.deepEqual(b.items["/admin/reopen-requests"], {
    text: "1",
    label: "Reopen requests, 1 pending",
    urgent: false,
  });
  assert.deepEqual(b.groups["work-queue"], { text: "6", label: "Work queue, 6 need action", urgent: true });
});

test("buildAdminNavBadges: group not urgent without overdue claims; caps at 99+", () => {
  const b = buildAdminNavBadges(normalizeQueueCounts({ messages: { open: 150 } }));
  assert.equal(b.groups["work-queue"]?.urgent, false);
  assert.equal(b.groups["work-queue"]?.text, "99+");
  assert.equal(b.items["/admin/messages"]?.text, "99+");
  // The accessible label keeps the real number.
  assert.equal(b.items["/admin/messages"]?.label, "Messages, 150 open");
});

test("buildAdminNavBadges: nothing at all when everything is clear or counts are unavailable", () => {
  assert.equal(buildAdminNavBadges(null), EMPTY_NAV_BADGES);
  assert.equal(buildAdminNavBadges(normalizeQueueCounts({})), EMPTY_NAV_BADGES);
});

test("groupControlLabel keeps the current-section hint", () => {
  const badge = { text: "2", label: "Work queue, 2 need action", urgent: false };
  assert.equal(groupControlLabel(badge, false), "Work queue, 2 need action");
  assert.equal(groupControlLabel(badge, true), "Work queue, 2 need action, current section");
  assert.equal(groupControlLabel(undefined, true), undefined);
});
