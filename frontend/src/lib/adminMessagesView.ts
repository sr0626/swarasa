// URL-state helpers for the admin inbox page (/admin/messages): the status
// tab, search text and page all live in the query string so every view is a
// real, shareable URL (same convention as /admin/reports). Pure, so it is
// unit-testable under `node --test`.
export type MessageTab = "open" | "resolved" | "all";

export const MESSAGE_TABS: ReadonlyArray<{ value: MessageTab; label: string }> = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const SEARCH_MAX_LENGTH = 100;

export function parseMessageTab(raw: string | undefined): MessageTab {
  return MESSAGE_TABS.some((t) => t.value === raw) ? (raw as MessageTab) : "open";
}

export function parseMessagePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Trimmed search text capped at the backend's limit; "" when absent. */
export function parseMessageQuery(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, SEARCH_MAX_LENGTH);
}

/** Omits defaults (open tab, page 1, empty search) to keep URLs short. */
export function messagesHref(tab: MessageTab, page: number, q: string): string {
  const params = new URLSearchParams();
  if (tab !== "open") params.set("status", tab);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/messages?${qs}` : "/admin/messages";
}
