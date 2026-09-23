// Admin "Owners" report -- owner directory: contact info, joined date,
// brand/location counts by status, verified locations, follower total and
// pending claims/reopen requests. Linked from the Platform Overview
// page's "Total owners" tile (admin/overview/page.tsx) and its own
// console nav item (components/console/navItems.ts). Owner-side
// counterpart of admin/registered-users/page.tsx.
//
// Server-driven, no client state: search + sort are a plain GET form
// (works without JS), pagination is link-based via searchParams -- same
// shape as the sibling read-only admin report pages. Local-DB data only
// (GET /admin/owners has no Cognito call) and no billing data.
//
// Unlike the Overview page's owner table (owners with >= 1 restaurant),
// this list includes every owner account, including ones that have not
// added a restaurant yet -- so its total can be higher than the Overview
// "Total owners" tile.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getAdminOwners } from "@/lib/api/adminOwners";
import {
  OWNER_SORTS,
  OWNER_SORT_LABELS,
  buildOwnersHref,
  parseOwnerSearch,
  parseOwnerSort,
  parsePage,
} from "@/lib/adminOwnersView";
import type { AdminOwnerRow } from "@/types/adminOwners";

export const metadata: Metadata = {
  title: "Owners",
};

const PAGE_SIZE = 20;

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-US", { dateStyle: "medium" });
}

interface OwnersPageProps {
  searchParams: { page?: string; q?: string; sort?: string };
}

export default async function AdminOwnersPage({ searchParams }: OwnersPageProps) {
  const session = await requireSession(["admin"]);
  const page = parsePage(searchParams.page);
  const q = parseOwnerSearch(searchParams.q);
  const sort = parseOwnerSort(searchParams.sort);

  let data: Awaited<ReturnType<typeof getAdminOwners>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getAdminOwners({ page, page_size: PAGE_SIZE, q, sort }, session.accessToken);
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading owners. Please try again.";
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Owners</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Every owner account with their restaurants broken down by location status, verified
        locations, followers and pending claim/reopen requests. Diner accounts are on the{" "}
        <Link
          href="/admin/registered-users"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Registered users
        </Link>{" "}
        page; platform-wide totals are on{" "}
        <Link
          href="/admin/overview"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Platform Overview
        </Link>
        .
      </p>

      <form method="get" action="/admin/owners" className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label
            htmlFor="owners-q"
            className="block text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle"
          >
            Search
          </label>
          <input
            id="owners-q"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            maxLength={100}
            placeholder="Email or name"
            className="mt-1 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink"
          />
        </div>
        <div>
          <label
            htmlFor="owners-sort"
            className="block text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle"
          >
            Sort by
          </label>
          <select
            id="owners-sort"
            name="sort"
            defaultValue={sort}
            className="mt-1 rounded-brand-control border border-brand-border bg-white px-3 py-2 text-sm text-brand-ink"
          >
            {OWNER_SORTS.map((option) => (
              <option key={option} value={option}>
                {OWNER_SORT_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-brand-control bg-brand-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Apply
        </button>
        {(q || sort !== "newest") && (
          <Link
            href="/admin/owners"
            className="py-2 text-sm text-brand-ink-muted underline-offset-2 hover:underline"
          >
            Reset
          </Link>
        )}
      </form>

      {loadError || !data ? (
        <p
          role="alert"
          className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {loadError}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-brand-ink-subtle">
            {data.total} {data.total === 1 ? "owner" : "owners"}
            {q ? ` matching “${q}”` : ""}
          </p>

          <div className="mt-3 overflow-x-auto rounded-brand-card border border-brand-border bg-white shadow-brand-card">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-brand-border text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                  <th scope="col" className="px-4 py-3">
                    Owner
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Joined
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Brands
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Locations
                  </th>
                  <th scope="col" className="px-4 py-3">
                    By status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Verified
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Followers
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Pending
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-brand-ink-subtle">
                      {q ? "No owners match this search." : "No owners yet."}
                    </td>
                  </tr>
                ) : (
                  data.results.map((owner) => <OwnerRow key={owner.id} owner={owner} />)
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Owner pages"
              className="mt-6 flex items-center justify-center gap-3 text-sm"
            >
              <PageLink href={buildOwnersHref({ page: page - 1, q, sort })} disabled={page <= 1}>
                &larr; Previous
              </PageLink>
              <span className="text-brand-ink-subtle">
                Page {page} of {totalPages}
              </span>
              <PageLink
                href={buildOwnersHref({ page: page + 1, q, sort })}
                disabled={page >= totalPages}
              >
                Next &rarr;
              </PageLink>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function OwnerRow({ owner }: { owner: AdminOwnerRow }) {
  const { by_status: status } = owner;
  const pending = owner.pending_claim_count + owner.pending_reopen_request_count;
  return (
    <tr className="border-b border-brand-border align-top last:border-0">
      <td className="px-4 py-3">
        {owner.personal_data_deleted ? (
          <>
            <span className="font-medium text-brand-ink-subtle">Deleted account</span>
            <span className="block text-xs text-brand-ink-subtle">
              Personal data removed on request (CCPA)
            </span>
          </>
        ) : (
          <>
            <span className="font-medium text-brand-ink">{owner.email}</span>
            {owner.full_name && (
              <span className="block text-xs text-brand-ink-muted">{owner.full_name}</span>
            )}
            {owner.phone && (
              <span className="block text-xs text-brand-ink-subtle">{owner.phone}</span>
            )}
          </>
        )}
      </td>
      <td className="px-4 py-3 text-brand-ink-muted">{formatDate(owner.joined_at)}</td>
      <td className="px-4 py-3 text-brand-ink">{owner.brand_count}</td>
      <td className="px-4 py-3 text-brand-ink">
        {owner.location_count > 0 || owner.brand_count > 0 ? (
          <Link
            href={`/admin/listings?owner_id=${owner.id}`}
            aria-label={`View ${owner.location_count} locations in the Listings page`}
            className="font-medium text-brand-accent underline-offset-2 hover:underline"
          >
            {owner.location_count}
          </Link>
        ) : (
          owner.location_count
        )}
      </td>
      <td className="px-4 py-3 text-xs text-brand-ink-muted">
        {owner.location_count === 0 ? (
          <span className="text-brand-ink-subtle">&mdash;</span>
        ) : (
          <ul className="space-y-0.5">
            <li>Active: {status.active}</li>
            <li>Hidden: {status.owner_deactivated}</li>
            <li>Coming soon: {status.coming_soon}</li>
            <li>Closed, pending reopen: {status.closed_pending_reopen}</li>
          </ul>
        )}
      </td>
      <td className="px-4 py-3 text-brand-ink-muted">
        {owner.verified_location_count} / {owner.location_count}
      </td>
      <td className="px-4 py-3 text-brand-ink-muted">{owner.follower_count}</td>
      <td className="px-4 py-3 text-xs text-brand-ink-muted">
        {pending === 0 ? (
          <span className="text-brand-ink-subtle">&mdash;</span>
        ) : (
          <ul className="space-y-0.5">
            {owner.pending_claim_count > 0 && (
              <li>
                <Link
                  href="/admin/claims"
                  className="text-brand-accent underline-offset-2 hover:underline"
                >
                  {owner.pending_claim_count} {owner.pending_claim_count === 1 ? "claim" : "claims"}
                </Link>
              </li>
            )}
            {owner.pending_reopen_request_count > 0 && (
              <li>
                <Link
                  href="/admin/reopen-requests"
                  className="text-brand-accent underline-offset-2 hover:underline"
                >
                  {owner.pending_reopen_request_count} reopen{" "}
                  {owner.pending_reopen_request_count === 1 ? "request" : "requests"}
                </Link>
              </li>
            )}
          </ul>
        )}
      </td>
    </tr>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-subtle/40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-muted transition hover:bg-brand-chip"
    >
      {children}
    </Link>
  );
}
