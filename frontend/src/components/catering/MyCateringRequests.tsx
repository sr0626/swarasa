"use client";

// The requester's request list: per request, the event summary, each
// restaurant's status and quote (cheapest first among quotes), and a
// two-step Cancel while the request is open.
import Link from "next/link";
import { useState } from "react";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { cancelCateringRequestAction } from "@/lib/actions/catering";
import {
  fulfillmentLabel,
  formatCents,
  formatEventDate,
  itemLine,
  quoteProgress,
  quotesCheapestFirst,
  recipientStatusLabel,
  requestStatusLabel,
} from "@/lib/catering/summary";
import type { CateringRecipient, CateringRequest } from "@/types/catering";

function StatusChip({ children, tone }: { children: string; tone: "ok" | "muted" | "warn" }) {
  const cls =
    tone === "ok"
      ? "bg-brand-success-bg text-brand-success"
      : tone === "warn"
        ? "bg-brand-closed-bg text-brand-closed"
        : "bg-brand-chip text-brand-chip-ink";
  return (
    <span className={`inline-flex items-center rounded-brand-pill px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function RecipientRow({ r }: { r: CateringRecipient }) {
  return (
    <li className="rounded-brand-control border border-brand-border bg-brand-bg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/restaurant/${r.brand_slug}/${r.location_slug}`}
          className="min-w-0 break-words text-sm font-semibold text-brand-ink underline"
        >
          {r.restaurant_name}
          <span className="font-normal text-brand-ink-subtle">, {r.city}</span>
        </Link>
        <StatusChip tone={r.status === "quoted" ? "ok" : r.status === "pending" ? "muted" : "warn"}>
          {recipientStatusLabel(r.status)}
        </StatusChip>
      </div>
      {r.status === "quoted" && r.quote_amount_cents !== null && (
        <p className="mt-2 text-lg font-bold text-brand-ink">{formatCents(r.quote_amount_cents)}</p>
      )}
      {r.quote_note && (
        <p className="mt-1 whitespace-pre-line break-words text-sm text-brand-ink-muted">{r.quote_note}</p>
      )}
      {r.status === "quoted" && r.quoted_at && (
        <p className="mt-1 text-xs text-brand-ink-subtle">
          Quoted <LocalDateTime value={r.quoted_at} />
        </p>
      )}
    </li>
  );
}

function RequestCard({
  request,
  onChanged,
}: {
  request: CateringRequest;
  onChanged: (next: CateringRequest) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await cancelCateringRequestAction(request.id);
    setBusy(false);
    setConfirming(false);
    if (result.ok) onChanged(result.data);
    else setError(result.error);
  }

  // Quotes first (cheapest first), then the rest in their original order.
  const quoted = quotesCheapestFirst(request.recipients);
  const others = request.recipients.filter((r) => !quoted.includes(r));

  return (
    <article className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-brand-ink">
            {formatEventDate(request.event_date)} &middot; {request.headcount} people
          </h2>
          <p className="text-sm text-brand-ink-muted">
            {fulfillmentLabel(request.delivery_or_pickup)}
            {request.delivery_or_pickup === "delivery" &&
              [request.delivery_city, request.delivery_zip].filter(Boolean).length > 0 &&
              ` to ${[request.delivery_city, request.delivery_zip].filter(Boolean).join(" ")}`}
          </p>
        </div>
        <StatusChip tone={request.status === "open" ? "ok" : "muted"}>
          {requestStatusLabel(request.status)}
        </StatusChip>
      </div>

      <ul className="mt-3 list-disc pl-5 text-sm text-brand-ink-muted">
        {request.items.map((item, i) => (
          <li key={i} className="break-words">
            {itemLine(item)}
            {item.note && ` — ${item.note}`}
          </li>
        ))}
      </ul>
      {request.notes && (
        <p className="mt-2 whitespace-pre-line break-words text-sm text-brand-ink-muted">
          <span className="font-semibold text-brand-ink">Notes: </span>
          {request.notes}
        </p>
      )}

      <h3 className="mt-4 text-sm font-semibold text-brand-ink">
        Restaurants <span className="font-normal text-brand-ink-subtle">({quoteProgress(request.recipients)})</span>
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {[...quoted, ...others].map((r) => (
          <RecipientRow key={r.location_id} r={r} />
        ))}
      </ul>

      <p className="mt-3 text-xs text-brand-ink-subtle">
        Sent <LocalDateTime value={request.created_at} variant="date" />
        {request.status === "open" && (
          <>
            {" "}
            &middot; open until <LocalDateTime value={request.expires_at} variant="date" />
          </>
        )}
      </p>

      {request.status === "open" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className={
              confirming
                ? "flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-closed px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                : "flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-closed px-4 text-sm font-semibold text-brand-closed transition hover:bg-brand-closed-bg disabled:opacity-60"
            }
          >
            {busy ? "Cancelling..." : confirming ? "Confirm cancel request" : "Cancel request"}
          </button>
          {confirming && !busy && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-[44px] px-1 text-sm font-medium text-brand-ink-subtle underline"
            >
              Keep it
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-brand-closed">
          {error}
        </p>
      )}
    </article>
  );
}

export default function MyCateringRequests({ initialRequests }: { initialRequests: CateringRequest[] }) {
  const [requests, setRequests] = useState(initialRequests);

  if (requests.length === 0) {
    return (
      <div className="rounded-brand-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
        <p className="font-display text-base font-semibold text-brand-ink">No catering requests yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
          Planning a party or event? Describe your order once and get quotes from several
          restaurants.
        </p>
        <Link
          href="/account/catering/new"
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
        >
          Request catering quotes
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          onChanged={(next) => setRequests((prev) => prev.map((r) => (r.id === next.id ? next : r)))}
        />
      ))}
    </div>
  );
}
