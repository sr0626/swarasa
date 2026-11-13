// Catering requests inbox for owners and assigned managers: requests
// addressed to THEIR locations (the API scopes this server-side), newest
// first, with an unread marker. Opening one marks it viewed and lets the
// restaurant send a quote or decline. In-app only — no email (SES deferred).
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import CateringPortalShell from "@/components/catering/CateringPortalShell";
import InfoPanel from "@/components/ui/InfoPanel";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { ApiError } from "@/lib/api/client";
import { getCateringInbox } from "@/lib/api/catering";
import {
  fulfillmentLabel,
  formatCents,
  formatEventDate,
  itemCountLabel,
  requesterLabel,
} from "@/lib/catering/summary";
import type { InboxList, InboxRow } from "@/types/catering";

export const metadata: Metadata = {
  title: "Catering requests",
};

const PAGE_SIZE = 20;

function rowState(row: InboxRow): { label: string; cls: string } {
  if (row.request_status === "cancelled") return { label: "Cancelled", cls: "bg-brand-chip text-brand-chip-ink" };
  if (row.status === "quoted") return { label: "Quoted", cls: "bg-brand-success-bg text-brand-success" };
  if (row.status === "declined") return { label: "Declined", cls: "bg-brand-chip text-brand-chip-ink" };
  if (row.status === "expired" || row.request_status === "closed") {
    return { label: "Expired", cls: "bg-brand-chip text-brand-chip-ink" };
  }
  return { label: "Needs a reply", cls: "bg-brand-accent/10 text-brand-accent" };
}

export default async function PortalCateringInboxPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const session = await requireSession(["owner", "manager"], "/portal/catering");
  const parsed = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;

  let inbox: InboxList | null = null;
  let loadError: string | null = null;
  try {
    inbox = await getCateringInbox({ page, page_size: PAGE_SIZE }, session.accessToken);
  } catch (error) {
    loadError =
      error instanceof ApiError ? error.message : "We couldn't load catering requests. Please try again.";
  }
  const totalPages = inbox ? Math.max(1, Math.ceil(inbox.total / PAGE_SIZE)) : 1;

  return (
    <CateringPortalShell session={session}>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Catering requests</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Diners ask for quotes here. You see their first name and event details; their contact
        details are shared with you once you send a quote. To receive requests, turn on
        &ldquo;Accept catering requests&rdquo; in each location&apos;s editor.
        {inbox && inbox.unread_count > 0 && (
          <>
            {" "}
            <span className="font-semibold text-brand-ink">{inbox.unread_count} unread.</span>
          </>
        )}
      </p>

      <div className="mt-6">
        {loadError || !inbox ? (
          <InfoPanel title="Couldn't load requests" body={loadError ?? "Please try again."} />
        ) : inbox.results.length === 0 ? (
          <InfoPanel
            title="No catering requests yet"
            body="When a diner sends a request to one of your locations, it will show up here."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {inbox.results.map((row) => {
              const state = rowState(row);
              return (
                <li key={row.recipient_id}>
                  <Link
                    href={`/portal/catering/${row.recipient_id}`}
                    className="block min-h-[44px] rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card transition hover:border-brand-ink-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 break-words font-semibold text-brand-ink">
                        {row.is_unread && (
                          <span
                            aria-label="Unread"
                            className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-brand-accent align-middle"
                          />
                        )}
                        {requesterLabel(row.requester_first_name)} &middot; {row.headcount} people
                      </p>
                      <span
                        className={`inline-flex items-center rounded-brand-pill px-2 py-0.5 text-xs font-semibold ${state.cls}`}
                      >
                        {state.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-brand-ink-muted">
                      {formatEventDate(row.event_date)} &middot; {fulfillmentLabel(row.delivery_or_pickup)} &middot;{" "}
                      {itemCountLabel(row.item_count)}
                    </p>
                    <p className="mt-1 text-xs text-brand-ink-subtle">
                      For {row.restaurant_name}, {row.city} &middot; received{" "}
                      <LocalDateTime value={row.created_at} variant="date" />
                      {row.status === "quoted" && row.quote_amount_cents !== null && (
                        <> &middot; your quote {formatCents(row.quote_amount_cents)}</>
                      )}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {inbox && totalPages > 1 && (
        <nav aria-label="Request pages" className="mt-8 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link
              href={`/portal/catering?page=${page - 1}`}
              className="flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Previous
            </Link>
          )}
          <span className="text-brand-ink-subtle">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/portal/catering?page=${page + 1}`}
              className="flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </CateringPortalShell>
  );
}
