// Admin claims queue — auth-gated (admin only). Backed by `GET /claim`
// (docs/API_CONTRACTS.md "Claim flow"): status filter via `?status=`
// (default `pending_review`, newest first) and numbered `?page=` pagination
// as plain links, so each view is a real URL. Approve / reject go through
// the Server Actions in ./actions.ts (POST /claim/{id}/approve|reject).
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import InfoPanel from "@/components/ui/InfoPanel";
import ClaimReviewPanel from "@/components/admin/ClaimReviewPanel";
import { ApiError } from "@/lib/api/client";
import { listClaims } from "@/lib/api/claim";
import type { ClaimQueueItem, ClaimStatus } from "@/types/claim";

export const metadata: Metadata = {
  title: "Claims Review",
};

const PAGE_SIZE = 20;

const TABS: ReadonlyArray<{ value: ClaimStatus; label: string }> = [
  { value: "pending_review", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

interface AdminClaimsPageProps {
  searchParams: { status?: string; page?: string };
}

function parseTab(raw: string | undefined): ClaimStatus {
  const match = TABS.find((t) => t.value === raw);
  return match ? match.value : "pending_review";
}

function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function hrefFor(tab: ClaimStatus, page: number): string {
  const params = new URLSearchParams();
  if (tab !== "pending_review") params.set("status", tab);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/claims?${qs}` : "/admin/claims";
}

export default async function AdminClaimsPage({ searchParams }: AdminClaimsPageProps) {
  const session = await requireSession(["admin"]);

  const tab = parseTab(searchParams.status);
  const page = parsePage(searchParams.page);

  let claims: ClaimQueueItem[] = [];
  let total = 0;
  let loadError: string | null = null;
  try {
    const result = await listClaims(
      { status: tab, page, page_size: PAGE_SIZE },
      session.accessToken
    );
    claims = result.results;
    total = result.total;
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading claims. Please try again.";
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Claims Review
      </h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Approve or reject restaurant ownership claims. Newest first.
      </p>

      <nav aria-label="Claim status" className="mt-6 flex flex-wrap gap-2">
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
          <InfoPanel title="Couldn't load claims" body={loadError} />
        ) : (
          <>
            <p className="mb-3 text-sm text-brand-ink-subtle">
              {total} {total === 1 ? "claim" : "claims"}
            </p>
            {/* Keyed so a filter/page change remounts with fresh data
                rather than reusing the previous view's local state. */}
            <ClaimReviewPanel
              key={`${tab}-${page}`}
              initialClaims={claims}
              statusFilter={tab}
            />
          </>
        )}
      </div>

      {!loadError && totalPages > 1 && (
        <nav
          aria-label="Claims pages"
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
