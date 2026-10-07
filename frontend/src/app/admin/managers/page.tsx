// Admin "Managers" report -- who manages which restaurants: one card per
// person with a location-manager assignment, showing email + name, when they
// were first assigned ("Manager since"), last seen, how many ACTIVE locations
// they manage, the owner(s) they work under, and a compact list of those
// locations (each links to the admin Listings page for that restaurant).
// Manager-side sibling of the Owners and Registered users reports.
//
// Who is listed: anyone with at least one assignment row, active or revoked
// (docs/API_CONTRACTS.md "GET /admin/managers") -- a manager whose
// assignments were all revoked shows "0 active locations". A Cognito manager
// who was never assigned anywhere has no local row and is not listed.
//
// Server-driven, no client state: search + sort are a plain GET form, paging
// is link-based. Cards (not a wide table) so it reads at 375px without any
// horizontal scroll. Times render via <LocalDateTime> in the viewer's own
// timezone. Emails come from Cognito best-effort: when that lookup fails the
// API sets `email_lookup_degraded` and we say so instead of showing blanks
// unexplained.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import { ApiError } from "@/lib/api/client";
import { getAdminManagers } from "@/lib/api/adminManagers";
import {
  MANAGER_SORTS,
  MANAGER_SORT_LABELS,
  buildReportHref,
  parsePage,
  parseSearch,
  parseSort,
} from "@/lib/adminReportView";
import { AdminReportPager, AdminReportSearchForm } from "@/components/admin/AdminReportControls";
import LocalDateTime from "@/components/ui/LocalDateTime";
import type { AdminManagerRow } from "@/types/adminManagers";

export const metadata: Metadata = {
  title: "Managers",
};

const PAGE_SIZE = 20;
const BASE_PATH = "/admin/managers";

interface ManagersPageProps {
  searchParams: { page?: string; q?: string; sort?: string };
}

export default async function AdminManagersPage({ searchParams }: ManagersPageProps) {
  const session = await requireSession(["admin"]);
  const page = parsePage(searchParams.page);
  const q = parseSearch(searchParams.q);
  const sort = parseSort(searchParams.sort, MANAGER_SORTS, "newest");

  let data: Awaited<ReturnType<typeof getAdminManagers>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getAdminManagers({ page, page_size: PAGE_SIZE, q, sort }, session.accessToken);
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading managers. Please try again.";
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Managers</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Everyone assigned as a location manager: which restaurants they manage and which owner
        they work under. Owners are on the{" "}
        <Link
          href="/admin/owners"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Owners
        </Link>{" "}
        page and diners on{" "}
        <Link
          href="/admin/registered-users"
          className="font-semibold text-brand-accent underline-offset-2 hover:underline"
        >
          Registered users
        </Link>
        . People whose assignments were all removed still appear, with 0 active locations. Times are
        shown in your local timezone.
      </p>

      <AdminReportSearchForm
        action={BASE_PATH}
        idPrefix="managers"
        q={q}
        sort={sort}
        defaultSort="newest"
        sortOptions={MANAGER_SORTS.map((value) => ({
          value,
          label: MANAGER_SORT_LABELS[value],
        }))}
        placeholder="Email or name"
      />

      {loadError || !data ? (
        <p
          role="alert"
          className="mt-6 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {loadError}
        </p>
      ) : (
        <>
          {data.email_lookup_degraded && (
            <p
              role="status"
              className="mt-4 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-ink"
            >
              Manager emails are unavailable right now (the sign-in service did not respond), so
              some rows show only an account ID and search matches names only. Try again shortly.
            </p>
          )}
          <p className="mt-4 text-sm text-brand-ink-subtle">
            {data.total} {data.total === 1 ? "manager" : "managers"}
            {q ? ` matching “${q}”` : ""}
          </p>

          {data.results.length === 0 ? (
            <p className="mt-3 rounded-brand-card border border-dashed border-brand-border bg-white p-5 text-sm text-brand-ink-muted">
              {q ? "No managers match this search." : "No managers have been assigned yet."}
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-4">
              {data.results.map((manager) => (
                <li key={manager.cognito_sub}>
                  <ManagerCard manager={manager} />
                </li>
              ))}
            </ul>
          )}

          <AdminReportPager
            label="Manager pages"
            page={page}
            totalPages={totalPages}
            hrefFor={(target) => buildReportHref(BASE_PATH, { page: target, q, sort }, "newest")}
          />
        </>
      )}
    </section>
  );
}

function ManagerCard({ manager }: { manager: AdminManagerRow }) {
  const count = manager.active_location_count;
  return (
    <div className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-all font-display text-base font-bold text-brand-ink sm:text-lg">
            {manager.email ?? (
              <span className="font-mono text-sm font-normal text-brand-ink-muted">
                {manager.cognito_sub.slice(0, 8)}
              </span>
            )}
          </h2>
          {manager.full_name && (
            <p className="text-sm text-brand-ink-muted">{manager.full_name}</p>
          )}
        </div>
        <span
          className={
            count > 0
              ? "inline-flex items-center rounded-brand-pill bg-brand-success-bg px-2.5 py-1 text-xs font-semibold text-brand-success"
              : "inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink"
          }
        >
          {count} active {count === 1 ? "location" : "locations"}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Manager since
          </dt>
          <dd className="mt-0.5 text-brand-ink-muted">
            <LocalDateTime value={manager.first_assigned_at} variant="date" fallback="Unknown" />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Last seen
          </dt>
          <dd className="mt-0.5 text-brand-ink-muted">
            <LocalDateTime value={manager.last_seen_at} fallback="Never" />
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            Works for
          </dt>
          <dd className="mt-0.5 text-brand-ink-muted">
            {manager.owners.length === 0 ? (
              <span className="text-brand-ink-subtle">&mdash;</span>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {manager.owners.map((owner) => (
                  <li key={owner.id} className="break-all">
                    {owner.email ? (
                      <Link
                        href={`/admin/owners?q=${encodeURIComponent(owner.email)}`}
                        className="inline-flex min-h-[44px] items-center text-brand-accent underline-offset-2 hover:underline sm:min-h-0"
                      >
                        {owner.email}
                      </Link>
                    ) : (
                      <span className="text-brand-ink-subtle">Deleted account</span>
                    )}
                    {owner.full_name && (
                      <span className="text-brand-ink-subtle"> ({owner.full_name})</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      {manager.locations.length > 0 && (
        <ul aria-label="Managed locations" className="mt-3 flex flex-wrap gap-2">
          {manager.locations.map((location) => (
            <li key={location.location_id}>
              <Link
                href={`/admin/listings?brand_id=${location.brand_id}`}
                className="flex min-h-[44px] items-center rounded-brand-pill border border-brand-border px-3 text-xs font-medium text-brand-ink transition hover:bg-brand-chip"
              >
                {location.location_name ?? location.brand_name} &mdash; {location.city}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
