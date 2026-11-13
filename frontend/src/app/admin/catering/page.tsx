// Read-only admin view of catering quote requests: who asked, event, status and
// per-status restaurant counts; search by requester email or name. Admins
// can't see item lists or quote amounts here — it's monitoring, not a work
// queue (GET /admin/catering, docs/API_CONTRACTS.md "Catering quote requests").
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import InfoPanel from "@/components/ui/InfoPanel";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { ApiError } from "@/lib/api/client";
import { listAdminCatering } from "@/lib/api/catering";
import { formatEventDate, requestStatusLabel } from "@/lib/catering/summary";
import { CATERING_SEARCH_MAX, type AdminCateringList, type CateringRequestStatus } from "@/types/catering";

export const metadata: Metadata = {
  title: "Catering requests",
};

const PAGE_SIZE = 20;
const TABS: ReadonlyArray<{ value: "" | CateringRequestStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

function href(status: string, q: string, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/catering?${qs}` : "/admin/catering";
}

export default async function AdminCateringPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; page?: string };
}) {
  const session = await requireSession(["admin"]);
  const status = TABS.some((t) => t.value === searchParams.status) ? (searchParams.status ?? "") : "";
  const q = (searchParams.q ?? "").trim().slice(0, CATERING_SEARCH_MAX);
  const parsed = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;

  let data: AdminCateringList | null = null;
  let loadError: string | null = null;
  try {
    data = await listAdminCatering(
      { q: q || undefined, status: (status || undefined) as CateringRequestStatus | undefined, page, page_size: PAGE_SIZE },
      session.accessToken
    );
  } catch (error) {
    loadError = error instanceof ApiError ? error.message : "Couldn't load catering requests. Please try again.";
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Catering requests</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Quote requests sent by registered users to subscribed restaurants (read-only).
        {data && (
          <>
            {" "}
            <span className="font-semibold text-brand-ink">{data.open_count} open</span> in total.
          </>
        )}
      </p>

      <nav aria-label="Request status" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.value || "all"}
            href={href(t.value, q, 1)}
            aria-current={t.value === status ? "page" : undefined}
            className={
              t.value === status
                ? "flex min-h-[44px] items-center rounded-brand-pill bg-brand-ink px-4 text-sm font-semibold text-brand-bg"
                : "flex min-h-[44px] items-center rounded-brand-pill border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <form action="/admin/catering" method="get" role="search" className="mt-4 flex flex-col gap-2 sm:flex-row">
        {status && <input type="hidden" name="status" value={status} />}
        <label htmlFor="catering-search" className="sr-only">
          Search by requester email or name
        </label>
        <input
          id="catering-search"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={CATERING_SEARCH_MAX}
          placeholder="Search requester email or name"
          className="min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-base text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none sm:max-w-md sm:text-sm"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
          >
            Search
          </button>
          {q && (
            <Link
              href={href(status, "", 1)}
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-5 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="mt-6">
        {loadError || !data ? (
          <InfoPanel title="Couldn't load requests" body={loadError ?? "Please try again."} />
        ) : data.results.length === 0 ? (
          <InfoPanel title="No catering requests" body="Nothing matches yet." />
        ) : (
          <ul className="flex flex-col gap-3">
            {data.results.map((row) => (
              <li
                key={row.id}
                className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-all font-semibold text-brand-ink">{row.requester_email}</p>
                  <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2 py-0.5 text-xs font-semibold text-brand-chip-ink">
                    {requestStatusLabel(row.status as CateringRequestStatus)}
                  </span>
                </div>
                {row.requester_name && <p className="text-sm text-brand-ink-muted">{row.requester_name}</p>}
                <p className="mt-1 text-sm text-brand-ink-muted">
                  {formatEventDate(row.event_date)} &middot; {row.headcount} people &middot; sent{" "}
                  <LocalDateTime value={row.created_at} variant="date" />
                </p>
                <p className="mt-1 text-xs text-brand-ink-subtle">
                  {row.recipient_count} restaurants: {row.quoted_count} quoted, {row.pending_count} waiting,{" "}
                  {row.declined_count} declined, {row.expired_count} no response
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && totalPages > 1 && (
        <nav aria-label="Request pages" className="mt-8 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link
              href={href(status, q, page - 1)}
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
              href={href(status, q, page + 1)}
              className="flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
