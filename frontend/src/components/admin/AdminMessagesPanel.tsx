"use client";

// Admin inbox list for "Contact admin" messages (docs/API_CONTRACTS.md
// "Contact admin"). Each card shows the message, who sent it (email, role,
// name) and the related location, and lets the admin mark it resolved or
// re-open it. The status tabs, search and pagination live on the page as real
// links / a GET form, so this component only owns per-card actions.
import { useState } from "react";
import Link from "next/link";
import { updateMessageStatusAction } from "@/app/admin/messages/actions";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { locationHref } from "@/lib/restaurant/urls";
import type { AdminMessage, AdminMessageStatus } from "@/types/adminMessage";

interface AdminMessagesPanelProps {
  initialMessages: AdminMessage[];
  /** Active status filter; a card that no longer matches after an action
   * is dropped from the list. `null` = "All" (nothing is dropped). */
  statusFilter: AdminMessageStatus | null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
};

function StatusBadge({ status }: { status: AdminMessageStatus }) {
  const tone =
    status === "resolved"
      ? "bg-brand-success-bg text-brand-success"
      : "bg-brand-chip text-brand-chip-ink";
  return (
    <span
      className={`inline-flex items-center rounded-brand-pill px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {status === "resolved" ? "Resolved" : "Open"}
    </span>
  );
}

export default function AdminMessagesPanel({
  initialMessages,
  statusFilter,
}: AdminMessagesPanelProps) {
  const [messages, setMessages] = useState<AdminMessage[]>(initialMessages);

  function handleUpdated(updated: AdminMessage) {
    setMessages((prev) =>
      prev.flatMap((m) => {
        if (m.message_id !== updated.message_id) return [m];
        // Drop the card once it no longer matches the active filter.
        return statusFilter === null || updated.status === statusFilter ? [updated] : [];
      })
    );
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-brand-card border border-dashed border-brand-border bg-white px-6 py-12 text-center">
        <p className="font-display text-base font-semibold text-brand-ink">Nothing here</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
          No messages match this view.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {messages.map((message) => (
        <li key={message.message_id}>
          <MessageCard message={message} onUpdated={handleUpdated} />
        </li>
      ))}
    </ul>
  );
}

function MessageCard({
  message,
  onUpdated,
}: {
  message: AdminMessage;
  onUpdated: (message: AdminMessage) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus: AdminMessageStatus = message.status === "open" ? "resolved" : "open";

  async function act() {
    setError(null);
    setPending(true);
    try {
      const result = await updateMessageStatusAction(message.message_id, nextStatus);
      if (result.ok) {
        onUpdated(result.message);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  const replyHref = `mailto:${message.sender_email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`;

  return (
    <article className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 break-words font-display text-lg font-bold text-brand-ink">
          {message.subject}
        </h2>
        <StatusBadge status={message.status} />
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-brand-ink">{message.body}</p>

      <dl className="mt-4 grid grid-cols-1 gap-2 rounded-brand-control bg-brand-bg p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-brand-ink-subtle">From</dt>
          <dd className="mt-0.5 break-all font-medium text-brand-ink">
            {message.sender_name ? `${message.sender_name} · ` : ""}
            <a
              href={replyHref}
              className="text-brand-accent underline-offset-2 hover:underline"
            >
              {message.sender_email}
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">Role</dt>
          <dd className="mt-0.5 font-medium text-brand-ink">
            {ROLE_LABEL[message.sender_role] ?? message.sender_role}
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">Sent</dt>
          <dd className="mt-0.5 font-medium text-brand-ink">
            <LocalDateTime iso={message.created_at} />
          </dd>
        </div>
        <div>
          <dt className="text-brand-ink-subtle">Related location</dt>
          <dd className="mt-0.5 break-words font-medium text-brand-ink">
            {message.related_location_label ? (
              message.related_location_brand_slug && message.related_location_slug ? (
                <Link
                  href={locationHref(
                    message.related_location_brand_slug,
                    message.related_location_slug
                  )}
                  className="text-brand-accent underline-offset-2 hover:underline"
                >
                  {message.related_location_label}
                </Link>
              ) : (
                message.related_location_label
              )
            ) : (
              <span className="font-normal text-brand-ink-subtle">None</span>
            )}
          </dd>
        </div>
        {message.resolved_at && (
          <div>
            <dt className="text-brand-ink-subtle">Resolved</dt>
            <dd className="mt-0.5 font-medium text-brand-ink">
              <LocalDateTime iso={message.resolved_at} />
            </dd>
          </div>
        )}
      </dl>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={replyHref}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-5 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
        >
          Reply by email
        </a>
        {message.status === "open" ? (
          <button
            type="button"
            disabled={pending}
            onClick={act}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-success px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Mark resolved"}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={act}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-5 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Re-open"}
          </button>
        )}
      </div>
    </article>
  );
}
