"use client";

// Activity feed section -- GET /auth/me/activity
// (docs/API_CONTRACTS.md "GET /auth/me/activity"). The app already writes
// an audit_log row for every write on
// restaurant_brand/restaurant_location/location_manager, including
// manager edits made on the owner's behalf, but there was no UI for an
// owner to ever see it. Server-rendered first page (see
// OwnerAccountView.tsx / app/account/page.tsx), client-side "Load more"
// from here on, same "keep the token server-side" shape as
// DataPrivacySection's export/delete actions.
//
// Shared with the manager console (2026-09-22, see ManagerAccountView.tsx)
// now that GET /auth/me/activity also serves manager callers with their
// own narrower row set (backend/app/services/audit_query_service.py) --
// the frontend side of that feed is identical (same fetch shape, same
// per-row rendering), only the heading/description copy differs, so
// `heading`/`description` are parameterized rather than forking a second
// component. Kept the `Owner*` name (like the backend's `OwnerActivity*`
// schema types it renders) to avoid a mechanical rename touching every
// consumer for no behavior change -- read it as "the activity feed
// section", not "owner-only".
import { useState } from "react";
import { getMyActivityAction } from "@/app/account/actions";
import { cardClass } from "@/components/account/accountShared";
import { ClockIcon } from "@/components/ui/icons";
import type { OwnerActivity } from "@/types/activity";
import type { PaginatedResponse } from "@/types/common";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ACTION_BADGE: Record<string, string> = {
  create: "bg-brand-success-bg text-brand-success",
  update: "bg-brand-chip text-brand-ink-muted",
  delete: "bg-brand-closed-bg text-brand-closed",
};

export default function OwnerActivitySection({
  initialPage,
  loadError,
  heading = "Recent activity",
  description = "Changes to your restaurants and locations, including edits made by your managers.",
}: {
  initialPage: PaginatedResponse<OwnerActivity> | null;
  loadError: string | null;
  /** Section heading -- defaults to the owner copy; manager console passes its own. */
  heading?: string;
  /** Subhead under the heading -- defaults to the owner copy; manager console passes its own. */
  description?: string;
}) {
  const [rows, setRows] = useState<OwnerActivity[]>(initialPage?.results ?? []);
  const [page, setPage] = useState(initialPage?.page ?? 1);
  const [total, setTotal] = useState(initialPage?.total ?? 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(loadError);

  const hasMore = rows.length < total;

  async function handleLoadMore() {
    setError(null);
    setLoadingMore(true);
    try {
      const result = await getMyActivityAction(page + 1);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows((prev) => [...prev, ...result.data.results]);
      setPage(result.data.page);
      setTotal(result.data.total);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="activity-heading" className={cardClass}>
      <div className="flex items-center gap-2">
        <ClockIcon className="h-5 w-5 text-brand-ink-muted" />
        <h2 id="activity-heading" className="font-display text-xl font-bold text-brand-ink">
          {heading}
        </h2>
      </div>
      <p className="mt-1 text-sm text-brand-ink-muted">{description}</p>

      {error && (
        <p role="alert" className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {error}
        </p>
      )}

      {rows.length === 0 && !error && (
        <p className="mt-4 text-sm text-brand-ink-muted">No activity yet.</p>
      )}

      {rows.length > 0 && (
        <ul className="mt-4 divide-y divide-brand-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-ink">{row.summary}</p>
                <p className="mt-0.5 text-xs text-brand-ink-muted">
                  {row.actor_label}
                  {!row.actor_resolved && " (name unavailable)"}
                  {" — "}
                  {formatDateTime(row.created_at)}
                </p>
              </div>
              <span
                className={`inline-flex w-fit shrink-0 items-center rounded-brand-pill px-2.5 py-1 text-xs font-semibold capitalize ${
                  ACTION_BADGE[row.action] ?? "bg-brand-chip text-brand-ink-muted"
                }`}
              >
                {row.action}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-brand-control border border-brand-border bg-white px-5 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </section>
  );
}
