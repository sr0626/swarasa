// Admin triage queue for public "report a problem" submissions — auth-gated
// (admin only). Backed by `GET /reports` (docs/API_CONTRACTS.md "Listing
// reports"): status filter via `?status=` (default `new`, oldest-first) and
// numbered `?page=` pagination as plain links, so each view is a real URL.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import InfoPanel from "@/components/ui/InfoPanel";
import ReportsTriagePanel from "@/components/admin/ReportsTriagePanel";
import { ApiError } from "@/lib/api/client";
import { listReports } from "@/lib/api/listingReports";
import type { ListingReport, ReportStatus } from "@/types/listingReport";

export const metadata: Metadata = {
  title: "Reports Triage",
};

const PAGE_SIZE = 20;

type StatusTab = ReportStatus | "all";

const TABS: ReadonlyArray<{ value: StatusTab; label: string }> = [
  { value: "new", label: "New" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

interface AdminReportsPageProps {
  searchParams: { status?: string; page?: string };
}

function parseTab(raw: string | undefined): StatusTab {
  return TABS.some((t) => t.value === raw) ? (raw as StatusTab) : "new";
}

function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function hrefFor(tab: StatusTab, page: number): string {
  const params = new URLSearchParams();
  if (tab !== "new") params.set("status", tab);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/reports?${qs}` : "/admin/reports";
}

export default async function AdminReportsPage({ searchParams }: AdminReportsPageProps) {
  const session = await requireSession(["admin"]);

  const tab = parseTab(searchParams.status);
  const page = parsePage(searchParams.page);
  const statusFilter: ReportStatus | null = tab === "all" ? null : tab;

  let reports: ListingReport[] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listReports(
      { status: statusFilter ?? undefined, page, page_size: PAGE_SIZE },
      session.accessToken
    );
    reports = result.results;
    total = result.total;
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading reports. Please try again.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Reports
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Problems visitors flagged on listings. Fix the listing, then mark the
        report resolved — or dismiss it if it isn&apos;t actionable.
      </p>

      <nav aria-label="Report status" className="mt-6 flex flex-wrap gap-2">
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
          <InfoPanel title="Couldn't load reports" body={loadError} />
        ) : (
          <>
            <p className="mb-3 text-sm text-brand-ink-subtle">
              {total} {total === 1 ? "report" : "reports"}
            </p>
            {/* Keyed so a filter/page change remounts with fresh data
                rather than reusing the previous view's local state. */}
            <ReportsTriagePanel
              key={`${tab}-${page}`}
              initialReports={reports}
              statusFilter={statusFilter}
            />
          </>
        )}
      </div>

      {!loadError && totalPages > 1 && (
        <nav
          aria-label="Reports pages"
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
