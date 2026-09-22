// Admin reopen-requests queue — auth-gated (admin only). Backed by
// `GET /location-reopen-requests` (docs/API_CONTRACTS.md "Location reopen
// requests"): status filter via `?status=` (default `pending_review`,
// oldest-first) and numbered `?page=` pagination as plain links, same
// pattern as /admin/claims/page.tsx. Approve / reject go through the
// Server Actions in ./actions.ts.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import InfoPanel from "@/components/ui/InfoPanel";
import ReopenRequestReviewPanel from "@/components/admin/ReopenRequestReviewPanel";
import { ApiError } from "@/lib/api/client";
import { listReopenRequests } from "@/lib/api/locationReopen";
import type { ReopenRequestQueueItem, ReopenRequestStatus } from "@/types/locationReopen";

export const metadata: Metadata = {
  title: "Reopen Requests",
};

const PAGE_SIZE = 20;

const TABS: ReadonlyArray<{ value: ReopenRequestStatus; label: string }> = [
  { value: "pending_review", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

interface AdminReopenRequestsPageProps {
  searchParams: { status?: string; page?: string };
}

function parseTab(raw: string | undefined): ReopenRequestStatus {
  const match = TABS.find((t) => t.value === raw);
  return match ? match.value : "pending_review";
}

function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function hrefFor(tab: ReopenRequestStatus, page: number): string {
  const params = new URLSearchParams();
  if (tab !== "pending_review") params.set("status", tab);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/reopen-requests?${qs}` : "/admin/reopen-requests";
}

export default async function AdminReopenRequestsPage({
  searchParams,
}: AdminReopenRequestsPageProps) {
  const session = await requireSession(["admin"]);

  const tab = parseTab(searchParams.status);
  const page = parsePage(searchParams.page);

  let requests: ReopenRequestQueueItem[] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listReopenRequests(
      { status: tab, page, page_size: PAGE_SIZE },
      session.accessToken
    );
    requests = result.results;
    total = result.total;
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading reopen requests. Please try again.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Reopen Requests
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Approve or reject requests to bring a closed location back to active. Oldest first.
      </p>

      <nav aria-label="Reopen request status" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={hrefFor(t.value, 1)}
            aria-current={t.value === tab ? "page" : undefined}
            className={
              t.value === tab
                ? "flex min-h-[40px] items-center rounded-brand-pill bg-brand-ink px-4 text-sm font-semibold text-brand-bg"
                : "flex min-h-[40px] items-center rounded-brand-pill border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {loadError ? (
          <InfoPanel title="Couldn't load reopen requests" body={loadError} />
        ) : (
          <>
            <p className="mb-3 text-sm text-brand-ink-subtle">
              {total} {total === 1 ? "request" : "requests"}
            </p>
            <ReopenRequestReviewPanel
              key={`${tab}-${page}`}
              initialRequests={requests}
              statusFilter={tab}
            />
          </>
        )}
      </div>

      {!loadError && totalPages > 1 && (
        <nav
          aria-label="Reopen requests pages"
          className="mt-8 flex items-center justify-center gap-3 text-sm"
        >
          {page > 1 ? (
            <Link
              href={hrefFor(tab, page - 1)}
              className="flex min-h-[40px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-brand-ink-subtle">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={hrefFor(tab, page + 1)}
              className="flex min-h-[40px] items-center rounded-brand-control border border-brand-border px-4 font-semibold text-brand-ink-muted transition hover:bg-brand-chip"
            >
              Next
            </Link>
          ) : null}
        </nav>
      )}
    </section>
  );
}
