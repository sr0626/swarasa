// Admin "Platform Overview" — platform-wide restaurant/tier/owner counts.
// Deliberately NOT named "Reports": that label is already taken by the
// report-a-problem triage queue (/admin/reports, ReportsTriagePanel.tsx).
//
// Every count tile links to the already-existing, already-filterable
// `/admin/listings` page (AdminListingsPanel.tsx, PR #177) for the
// underlying restaurant list, rather than rebuilding a second restaurant
// list UI here — this page stays read-only stats + links, same
// server-driven, no-client-state shape as the rest of the admin console
// wherever it doesn't need interactivity (contrast with
// AdminListingsPanel.tsx's client-side expand/delete state, which this
// page has no need for).
//
// Grain judgment call (see docs/API_CONTRACTS.md "GET /admin/overview"
// and backend/app/services/admin_overview_service.py for the full
// writeup): the restaurant/tier tiles are brand-grain (so each tile's
// number matches the `total` its `/admin/listings?...` link shows), while
// the owner table's per-status counts are location-grain (an owner's
// actual location count, which sums cleanly). Both are called out again
// inline below, next to where each is rendered.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getAdminOverview } from "@/lib/api/adminOverview";
import { getRegisteredUserCount } from "@/lib/api/adminStats";
import type { LocationStatus } from "@/types/location";

export const metadata: Metadata = {
  title: "Platform Overview",
};

const PAGE_SIZE = 20;

// Same labels/order as AdminListingsPanel.tsx's STATUS_LABELS/STATUS_OPTIONS
// -- kept as a local copy rather than importing from that (client)
// component, since this page is a plain Server Component and the two
// lists are small enough that duplicating them is less friction than
// restructuring AdminListingsPanel.tsx to export shared constants.
const STATUS_LABELS: Record<LocationStatus, string> = {
  active: "Active",
  owner_deactivated: "Hidden — owner deactivated",
  coming_soon: "Coming soon",
  closed_pending_reopen: "Closed — pending reopen",
};

const STATUS_ORDER: readonly LocationStatus[] = [
  "active",
  "owner_deactivated",
  "coming_soon",
  "closed_pending_reopen",
];

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

interface AdminOverviewPageProps {
  searchParams: { page?: string };
}

export default async function AdminOverviewPage({ searchParams }: AdminOverviewPageProps) {
  const session = await requireSession(["admin"]);
  const page = parsePositiveInt(searchParams.page) ?? 1;

  let overview: Awaited<ReturnType<typeof getAdminOverview>> | null = null;
  let loadError: string | null = null;
  try {
    overview = await getAdminOverview({ page, page_size: PAGE_SIZE }, session.accessToken);
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading the platform overview. Please try again.";
  }

  // Separate endpoint, separate failure mode (docs/API_CONTRACTS.md "GET
  // /admin/registered-user-count" -- a live Cognito call that can 502 on
  // an upstream error). Fetched and error-handled independently of
  // `overview` above so a Cognito hiccup degrades this one tile, not the
  // whole page.
  let registeredUserCount: number | null = null;
  let registeredUserCountUnavailable = false;
  try {
    registeredUserCount = (await getRegisteredUserCount(session.accessToken)).count;
  } catch {
    registeredUserCountUnavailable = true;
  }

  const totalOwnerPages = overview ? Math.max(1, Math.ceil(overview.owners.total_owners / PAGE_SIZE)) : 1;

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Platform Overview
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Platform-wide restaurant, tier and owner counts. Every tile links to the filtered{" "}
        <Link
          href="/admin/listings"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Listings
        </Link>{" "}
        page for the underlying rows.
      </p>

      {loadError || !overview ? (
        <p className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {loadError}
        </p>
      ) : (
        <>
          <h2 className="mt-8 font-display text-lg font-bold text-brand-ink">Restaurants</h2>
          <div
            aria-label="Restaurant counts"
            className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3"
          >
            <StatTile label="Total restaurants" value={overview.restaurants.total} href="/admin/listings" />
            {STATUS_ORDER.map((status) => (
              <StatTile
                key={status}
                label={STATUS_LABELS[status]}
                value={overview.restaurants.by_status[status]}
                href={`/admin/listings?status=${status}`}
              />
            ))}
            <StatTile
              label="Paid"
              value={overview.restaurants.by_tier.paid}
              href="/admin/listings?is_paid=true"
            />
            <StatTile
              label="Free"
              value={overview.restaurants.by_tier.free}
              href="/admin/listings?is_paid=false"
            />
          </div>
          <p className="mt-2 text-xs text-brand-ink-subtle">
            &ldquo;Paid&rdquo; means the restaurant has at least one paid location. A restaurant with
            locations in more than one status or tier is counted in every tile it matches, so these
            numbers do not need to add up to the total — same &ldquo;any location&rdquo; rule the
            Listings filters above already use.
          </p>

          <h2 className="mt-8 font-display text-lg font-bold text-brand-ink">Owners</h2>
          <div aria-label="Owner counts" className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <StatTile label="Total owners" value={overview.owners.total_owners} />
            {/* Sourced from a separate endpoint (GET /admin/registered-user-count,
                a live Cognito call), not GET /admin/overview's own
                registered_user_count field (which stays null by design -- see
                docs/API_CONTRACTS.md "GET /admin/overview"). Handled as its own
                loading/error state above so a Cognito hiccup only degrades this
                one tile. */}
            {registeredUserCountUnavailable ? (
              <div className="rounded-brand-card border border-dashed border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                  Registered users
                </p>
                <p className="mt-1 text-sm text-brand-closed">Unavailable right now</p>
              </div>
            ) : (
              <StatTile label="Registered users" value={registeredUserCount ?? 0} />
            )}
          </div>

          <p className="mt-4 text-sm text-brand-ink-subtle">
            Each owner&rsquo;s restaurant count below is their actual location count, broken down by
            status — a different (location-level) count than the brand-level tiles above.
          </p>

          <div className="mt-3 overflow-x-auto rounded-brand-card border border-brand-border bg-white shadow-brand-card">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-brand-border text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                  <th scope="col" className="px-4 py-3">
                    Owner
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Restaurants
                  </th>
                  {STATUS_ORDER.map((status) => (
                    <th key={status} scope="col" className="px-4 py-3">
                      {STATUS_LABELS[status]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.owners.results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2 + STATUS_ORDER.length}
                      className="px-4 py-6 text-center text-brand-ink-subtle"
                    >
                      No owners yet.
                    </td>
                  </tr>
                ) : (
                  overview.owners.results.map((owner) => (
                    <tr key={owner.owner_id} className="border-b border-brand-border last:border-0">
                      <td className="px-4 py-3 font-medium text-brand-ink">
                        <Link
                          href={`/admin/listings?owner_email=${encodeURIComponent(owner.email)}`}
                          className="text-brand-accent underline-offset-2 hover:underline"
                        >
                          {owner.email}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-brand-ink">{owner.restaurant_count}</td>
                      {STATUS_ORDER.map((status) => (
                        <td key={status} className="px-4 py-3 text-brand-ink-muted">
                          {owner.by_status[status]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalOwnerPages > 1 && (
            <nav
              aria-label="Owner pages"
              className="mt-6 flex items-center justify-center gap-3 text-sm"
            >
              <OwnerPageLink page={page - 1} disabled={page <= 1}>
                &larr; Previous
              </OwnerPageLink>
              <span className="text-brand-ink-subtle">
                Page {page} of {totalOwnerPages}
              </span>
              <OwnerPageLink page={page + 1} disabled={page >= totalOwnerPages}>
                Next &rarr;
              </OwnerPageLink>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function StatTile({ label, value, href }: { label: string; value: number; href?: string }) {
  const card = (
    <div className="h-full rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card transition sm:p-5 hover:border-brand-accent">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold text-brand-ink">{value}</p>
    </div>
  );
  if (!href) return card;
  return (
    <Link href={href} aria-label={`${label}: ${value}. View list.`} className="block">
      {card}
    </Link>
  );
}

function OwnerPageLink({
  page,
  disabled,
  children,
}: {
  page: number;
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
      href={`/admin/overview?page=${page}`}
      className="rounded-brand-control border border-brand-border px-3 py-2 text-brand-ink-muted transition hover:bg-brand-chip"
    >
      {children}
    </Link>
  );
}
