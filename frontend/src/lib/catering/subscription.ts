// Display + validation helpers for the admin MANUAL subscription control
// (admin Listings page). Pure — see subscription.test.ts. The flag is set by
// hand, no payment is taken, until a payment processor exists.

/** Always shown next to the control so nobody mistakes it for billing. */
export const MANUAL_LABEL = "MANUAL (testing, no payment taken)";

/** "2027-01-31T23:59:59Z" -> "2027-01-31" (the calendar date the admin chose). */
export function datePart(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Status text. `subscribed` follows the server's rule: is_paid AND
 * (no end date OR end date in the future). `nowMs` is injected for tests.
 */
export function describeSubscription(
  isPaid: boolean,
  paidUntil: string | null,
  nowMs: number = Date.now()
): { subscribed: boolean; text: string } {
  if (!isPaid) return { subscribed: false, text: "Not subscribed" };
  if (!paidUntil) return { subscribed: true, text: "Subscribed (no end date)" };
  const end = Date.parse(paidUntil);
  if (Number.isNaN(end)) return { subscribed: true, text: "Subscribed (no end date)" };
  if (end <= nowMs) return { subscribed: false, text: `Subscription ended ${datePart(paidUntil)}` };
  return { subscribed: true, text: `Subscribed until ${datePart(paidUntil)}` };
}

/** Empty = open-ended (allowed). Otherwise a real calendar date strictly after `todayIso`. */
export function validateUntilDate(value: string, todayIso: string): string | null {
  if (value === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "Choose a valid end date, or leave it empty for no end date.";
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCMonth() !== Number(m[2]) - 1) return "Choose a valid end date.";
  if (value <= todayIso) return "The end date must be in the future.";
  return null;
}
