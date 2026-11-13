// Pure display helpers for catering quote requests (labels, money, dates,
// one-line summaries). No React / Next imports so it runs under `node --test`
// (see summary.test.ts). Type imports are erased, so the `@/` alias is fine.
import type {
  CateringFulfillment,
  CateringItem,
  CateringItemSize,
  CateringRecipient,
  CateringRecipientStatus,
  CateringRequestStatus,
} from "@/types/catering";

/** Tray sizes in the order the form offers them. */
export const SIZE_OPTIONS: ReadonlyArray<{ value: CateringItemSize; label: string }> = [
  { value: "full_tray", label: "Full tray" },
  { value: "medium_tray", label: "Medium tray" },
  { value: "flat_tray", label: "Flat tray" },
  { value: "other", label: "Other" },
];

export function sizeLabel(size: CateringItemSize): string {
  return SIZE_OPTIONS.find((s) => s.value === size)?.label ?? "Other";
}

export function fulfillmentLabel(value: CateringFulfillment): string {
  return value === "delivery" ? "Delivery" : "Pickup";
}

/** 45050 -> "$450.50"; thousands separated, always two decimals. */
export function formatCents(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `$${dollars.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

/** "2026-11-21" -> "Sat, Nov 21, 2026". Date-only strings carry no timezone, so
 * format in UTC (never shift a calendar date by the viewer's offset). */
export function formatEventDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2 x Chicken biryani (Full tray)". */
export function itemLine(item: Pick<CateringItem, "item_name" | "size" | "quantity">): string {
  return `${item.quantity} × ${item.item_name} (${sizeLabel(item.size)})`;
}

/** "3 items" / "1 item". */
export function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

export function recipientStatusLabel(status: CateringRecipientStatus): string {
  switch (status) {
    case "pending":
      return "Waiting for a quote";
    case "quoted":
      return "Quote received";
    case "declined":
      return "Declined";
    default:
      return "No response";
  }
}

export function requestStatusLabel(status: CateringRequestStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "cancelled":
      return "Cancelled";
    default:
      return "Expired";
  }
}

/** "Priya" or, when the diner has no name on file, "A diner". */
export function requesterLabel(firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  return name || "A diner";
}

/** "3 of 5 restaurants have quoted" style progress for a request. */
export function quoteProgress(recipients: ReadonlyArray<Pick<CateringRecipient, "status">>): string {
  const quoted = recipients.filter((r) => r.status === "quoted").length;
  return `${quoted} of ${recipients.length} ${recipients.length === 1 ? "restaurant has" : "restaurants have"} quoted`;
}

/** Quotes only, cheapest first (ties keep the original order). */
export function quotesCheapestFirst<T extends Pick<CateringRecipient, "status" | "quote_amount_cents">>(
  recipients: ReadonlyArray<T>
): T[] {
  return recipients
    .filter((r) => r.status === "quoted" && r.quote_amount_cents !== null)
    .map((r, index) => ({ r, index }))
    .sort((a, b) => (a.r.quote_amount_cents as number) - (b.r.quote_amount_cents as number) || a.index - b.index)
    .map(({ r }) => r);
}

/** Restaurant inbox: requester's contact is only shown once THIS restaurant quoted. */
export function contactRevealed(detail: {
  requester_email: string | null;
  requester_phone: string | null;
}): boolean {
  return Boolean(detail.requester_email || detail.requester_phone);
}
