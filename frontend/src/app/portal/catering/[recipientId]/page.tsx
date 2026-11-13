// One catering request, from a restaurant's side. Opening it marks it viewed
// (GET /catering/inbox/{id}). Shows the first name + event details; the
// diner's email/phone appear only after THIS restaurant has sent a quote.
// A foreign or unknown id is a plain "not found" (the API 404s both).
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import CateringPortalShell from "@/components/catering/CateringPortalShell";
import CateringResponseForm from "@/components/catering/CateringResponseForm";
import InfoPanel from "@/components/ui/InfoPanel";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { getCateringInboxDetail } from "@/lib/api/catering";
import {
  contactRevealed,
  fulfillmentLabel,
  formatEventDate,
  itemLine,
  requesterLabel,
} from "@/lib/catering/summary";
import type { InboxDetail } from "@/types/catering";

export const metadata: Metadata = {
  title: "Catering request",
};

export default async function PortalCateringDetailPage({
  params,
}: {
  params: { recipientId: string };
}) {
  const recipientId = Number.parseInt(params.recipientId, 10);
  const session = await requireSession(
    ["owner", "manager"],
    `/portal/catering/${Number.isInteger(recipientId) ? recipientId : ""}`
  );

  let detail: InboxDetail | null = null;
  if (Number.isInteger(recipientId) && recipientId > 0 && String(recipientId) === params.recipientId) {
    try {
      detail = await getCateringInboxDetail(recipientId, session.accessToken);
    } catch {
      detail = null; // 404 (not yours / gone) and API errors look identical.
    }
  }

  const back = (
    <Link
      href="/portal/catering"
      className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-ink-muted underline"
    >
      Back to catering requests
    </Link>
  );

  if (!detail) {
    return (
      <CateringPortalShell session={session}>
        {back}
        <div className="mt-3">
          <InfoPanel
            title="Request not found"
            body="This request either doesn't exist or isn't addressed to one of your locations."
          />
        </div>
      </CateringPortalShell>
    );
  }

  const revealed = contactRevealed(detail);

  return (
    <CateringPortalShell session={session}>
      {back}
      <h1 className="mt-1 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        {requesterLabel(detail.requester_first_name)} &middot; {detail.headcount} people
      </h1>
      <p className="mt-1 text-sm text-brand-ink-muted">
        For {detail.restaurant_name}, {detail.city} &middot; received{" "}
        <LocalDateTime value={detail.created_at} variant="date" />
      </p>

      <div className="mt-5 flex flex-col gap-5">
        <section className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
          <h2 className="font-display text-lg font-bold text-brand-ink">Event</h2>
          <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-brand-ink">Date</dt>
              <dd className="text-brand-ink-muted">{formatEventDate(detail.event_date)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-brand-ink">People</dt>
              <dd className="text-brand-ink-muted">{detail.headcount}</dd>
            </div>
            <div>
              <dt className="font-semibold text-brand-ink">Fulfilment</dt>
              <dd className="text-brand-ink-muted">
                {fulfillmentLabel(detail.delivery_or_pickup)}
                {detail.delivery_or_pickup === "delivery" &&
                  [detail.delivery_city, detail.delivery_zip].filter(Boolean).length > 0 &&
                  ` to ${[detail.delivery_city, detail.delivery_zip].filter(Boolean).join(" ")}`}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-brand-ink">Reply by</dt>
              <dd className="text-brand-ink-muted">
                <LocalDateTime value={detail.expires_at} variant="date" />
              </dd>
            </div>
          </dl>
          <h3 className="mt-4 text-sm font-semibold text-brand-ink">Items</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-brand-ink-muted">
            {detail.items.map((item, i) => (
              <li key={i} className="break-words">
                {itemLine(item)}
                {item.note && ` — ${item.note}`}
              </li>
            ))}
          </ul>
          {detail.notes && (
            <p className="mt-3 whitespace-pre-line break-words text-sm text-brand-ink-muted">
              <span className="font-semibold text-brand-ink">Notes: </span>
              {detail.notes}
            </p>
          )}
        </section>

        <section className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
          <h2 className="font-display text-lg font-bold text-brand-ink">Contact</h2>
          {revealed ? (
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
              {detail.requester_email && (
                <div className="min-w-0">
                  <dt className="font-semibold text-brand-ink">Email</dt>
                  <dd className="break-all text-brand-ink-muted">
                    <a className="underline" href={`mailto:${detail.requester_email}`}>
                      {detail.requester_email}
                    </a>
                  </dd>
                </div>
              )}
              {detail.requester_phone && (
                <div>
                  <dt className="font-semibold text-brand-ink">Phone</dt>
                  <dd className="text-brand-ink-muted">{detail.requester_phone}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-brand-ink-muted">
              The diner&apos;s email and phone are shared with you once you send a quote.
            </p>
          )}
        </section>

        <CateringResponseForm
          key={`${detail.recipient_id}-${detail.status}-${detail.quote_amount_cents ?? ""}`}
          detail={detail}
        />
      </div>
    </CateringPortalShell>
  );
}
