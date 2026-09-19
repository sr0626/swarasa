// Numbered pagination for the search results page, driven directly off
// `SearchResponse.page`/`page_size`/`total` (docs/API_CONTRACTS.md "GET
// /search"). Plain `<Link>`s (not a client-side click handler) so each
// page is its own real, crawlable, SSR'd URL — consistent with
// frontend/CLAUDE.md "ALWAYS SSR ... search pages".
import Link from "next/link";
import { buildSearchHref, type SearchFilters } from "@/lib/search/filters";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Non-page state to carry across page links (location, q, tag filters). */
  location: string;
  query: string;
  filters: SearchFilters;
}

function hrefForPage(pageNum: number, base: Omit<PaginationProps, "page" | "pageSize" | "total">): string {
  return buildSearchHref({ ...base, page: pageNum });
}

/** Page numbers to render: first, last, and a window around the current
 * page, with `null` standing in for an ellipsis gap. */
function buildPageList(current: number, totalPages: number): (number | null)[] {
  const pages = new Set<number>([1, totalPages, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const result: (number | null)[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push(null);
    result.push(p);
    prev = p;
  }
  return result;
}

export default function Pagination({ page, pageSize, total, location, query, filters }: PaginationProps) {
  const base = { location, query, filters };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const pageList = buildPageList(page, totalPages);

  return (
    <nav aria-label="Search results pages" className="mt-8 flex items-center justify-center gap-1.5">
      <Link
        href={hrefForPage(Math.max(1, page - 1), base)}
        aria-disabled={page <= 1}
        aria-label="Previous page"
        className={
          page <= 1
            ? "pointer-events-none flex min-h-[40px] min-w-[40px] items-center justify-center rounded-brand-control border border-brand-border text-sm text-brand-ink-subtle/40"
            : "flex min-h-[40px] min-w-[40px] items-center justify-center rounded-brand-control border border-brand-border text-sm text-brand-ink-muted transition hover:bg-brand-chip"
        }
      >
        &larr;
      </Link>

      {pageList.map((p, i) =>
        p === null ? (
          <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-brand-ink-subtle">
            &hellip;
          </span>
        ) : (
          <Link
            key={p}
            href={hrefForPage(p, base)}
            aria-current={p === page ? "page" : undefined}
            className={
              p === page
                ? "flex min-h-[40px] min-w-[40px] items-center justify-center rounded-brand-control bg-brand-ink text-sm font-semibold text-brand-bg"
                : "flex min-h-[40px] min-w-[40px] items-center justify-center rounded-brand-control border border-brand-border text-sm text-brand-ink-muted transition hover:bg-brand-chip"
            }
          >
            {p}
          </Link>
        )
      )}

      <Link
        href={hrefForPage(Math.min(totalPages, page + 1), base)}
        aria-disabled={page >= totalPages}
        aria-label="Next page"
        className={
          page >= totalPages
            ? "pointer-events-none flex min-h-[40px] min-w-[40px] items-center justify-center rounded-brand-control border border-brand-border text-sm text-brand-ink-subtle/40"
            : "flex min-h-[40px] min-w-[40px] items-center justify-center rounded-brand-control border border-brand-border text-sm text-brand-ink-muted transition hover:bg-brand-chip"
        }
      >
        &rarr;
      </Link>
    </nav>
  );
}
