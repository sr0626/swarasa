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
//
// Detail table (2026-09-24, direct user feedback -- "Location status updated,
// You, Sep 24 10:45 PM" lacked detail): one row per changed field with
// When (in the location's timezone, labelled) / Restaurant + location /
// What changed / Previous / New / Updated by. A real <table> from `lg` up;
// stacked cards on a phone (no horizontal page scroll at 375px). Row building
// lives in lib/activity/ownerFeedRows.ts (unit-tested).
import { useState } from "react";
import { getMyActivityAction } from "@/app/account/actions";
import { cardClass } from "@/components/account/accountShared";
import { ClockIcon } from "@/components/ui/icons";
import { toActivityRows, type ActivityTableRow } from "@/lib/activity/ownerFeedRows";
import { formatZonedDateTime } from "@/lib/format/zonedDateTime";
import type { OwnerActivity } from "@/types/activity";
import type { PaginatedResponse } from "@/types/common";

function ActorCell({ row }: { row: ActivityTableRow }) {
  return (
    <>
      <span className="break-words font-medium text-brand-ink">{row.updatedBy}</span>
      {row.updatedByRole && (
        <span className="block text-xs text-brand-ink-subtle">{row.updatedByRole}</span>
      )}
    </>
  );
}

function PlaceCell({ row }: { row: ActivityTableRow }) {
  return (
    <>
      <span className="break-words font-medium text-brand-ink">{row.restaurant}</span>
      {row.location && (
        <span className="block break-words text-xs text-brand-ink-subtle">{row.location}</span>
      )}
    </>
  );
}

export default function OwnerActivitySection({
  initialPage,
  loadError,
  heading = "Recent activity",
  description = "Changes to your restaurants and locations, including edits made by your managers.",
  headingAs: Heading = "h2",
}: {
  initialPage: PaginatedResponse<OwnerActivity> | null;
  loadError: string | null;
  /** Section heading -- defaults to the owner copy; manager console passes its own. */
  heading?: string;
  /** Subhead under the heading -- defaults to the owner copy; manager console passes its own. */
  description?: string;
  /** Heading element: "h1" when the feed is the page's own main content (/account/activity). */
  headingAs?: "h1" | "h2";
}) {
  const [rows, setRows] = useState<OwnerActivity[]>(initialPage?.results ?? []);
  const [page, setPage] = useState(initialPage?.page ?? 1);
  const [total, setTotal] = useState(initialPage?.total ?? 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(loadError);

  const tableRows = toActivityRows(rows, formatZonedDateTime);
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
        <Heading id="activity-heading" className="font-display text-xl font-bold text-brand-ink">
          {heading}
        </Heading>
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

      {tableRows.length > 0 && (
        <>
          {/* Phone / tablet: one card per change. */}
          <ul className="mt-4 divide-y divide-brand-border lg:hidden">
            {tableRows.map((row) => (
              <li key={row.key} className="py-3 first:pt-0 last:pb-0">
                <p className="break-words text-sm font-semibold text-brand-ink">{row.what}</p>
                <dl className="mt-1.5 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-brand-ink-subtle">Previous</dt>
                  <dd className="min-w-0 break-words text-brand-ink-muted">{row.previous}</dd>
                  <dt className="text-brand-ink-subtle">New</dt>
                  <dd className="min-w-0 break-words font-medium text-brand-ink">{row.next}</dd>
                  <dt className="text-brand-ink-subtle">Where</dt>
                  <dd className="min-w-0">
                    <PlaceCell row={row} />
                  </dd>
                  <dt className="text-brand-ink-subtle">By</dt>
                  <dd className="min-w-0">
                    <ActorCell row={row} />
                  </dd>
                  <dt className="text-brand-ink-subtle">When</dt>
                  <dd className="min-w-0 text-brand-ink-muted">{row.when}</dd>
                </dl>
              </li>
            ))}
          </ul>

          {/* Desktop: a real table. */}
          <div className="mt-4 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">Recent changes to your listings</caption>
              <thead>
                <tr className="border-b border-brand-border text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                  <th scope="col" className="w-[17%] py-2 pr-3">When</th>
                  <th scope="col" className="w-[17%] py-2 pr-3">Restaurant / location</th>
                  <th scope="col" className="w-[14%] py-2 pr-3">What changed</th>
                  <th scope="col" className="w-[17%] py-2 pr-3">Previous</th>
                  <th scope="col" className="w-[17%] py-2 pr-3">New</th>
                  <th scope="col" className="w-[18%] py-2">Updated by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border align-top">
                {tableRows.map((row) => (
                  <tr key={row.key}>
                    <td className="py-3 pr-3 text-brand-ink-muted">{row.when}</td>
                    <td className="break-words py-3 pr-3">
                      <PlaceCell row={row} />
                    </td>
                    <td className="break-words py-3 pr-3 font-semibold text-brand-ink">{row.what}</td>
                    <td className="break-words py-3 pr-3 text-brand-ink-muted">{row.previous}</td>
                    <td className="break-words py-3 pr-3 font-medium text-brand-ink">{row.next}</td>
                    <td className="break-words py-3">
                      <ActorCell row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
