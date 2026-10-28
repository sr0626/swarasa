// Crawlable numbered pagination for a city landing page: every page is a real
// `<Link>` to `/indian-restaurants/{slug}?page=N` (page 1 = the bare path), so
// crawlers reach every restaurant without JavaScript. 44px tap targets.
import Link from "next/link";
import { cityPagePath } from "@/lib/city/paths";
import { buildPageList, totalPages } from "@/lib/city/pagination";

const BASE = "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-brand-control border text-sm";
const IDLE = `${BASE} border-brand-border text-brand-ink-muted transition hover:bg-brand-chip`;
const CURRENT = `${BASE} border-brand-ink bg-brand-ink font-semibold text-brand-bg`;
const DISABLED = `${BASE} pointer-events-none border-brand-border text-brand-ink-subtle/50`;

interface CityPaginationProps {
  citySlug: string;
  page: number;
  pageSize: number;
  total: number;
}

export default function CityPagination({ citySlug, page, pageSize, total }: CityPaginationProps) {
  const pages = totalPages(total, pageSize);
  if (pages <= 1) return null;

  return (
    <nav aria-label="Restaurant pages" className="mt-8 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={cityPagePath(citySlug, page - 1)} rel="prev" aria-label="Previous page" className={IDLE}>
          &larr;
        </Link>
      ) : (
        <span aria-hidden="true" className={DISABLED}>
          &larr;
        </span>
      )}

      {buildPageList(page, pages).map((p, i) =>
        p === null ? (
          <span key={`gap-${i}`} aria-hidden="true" className="px-1.5 text-sm text-brand-ink-subtle">
            &hellip;
          </span>
        ) : (
          <Link
            key={p}
            href={cityPagePath(citySlug, p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            className={p === page ? CURRENT : IDLE}
          >
            {p}
          </Link>
        )
      )}

      {page < pages ? (
        <Link href={cityPagePath(citySlug, page + 1)} rel="next" aria-label="Next page" className={IDLE}>
          &rarr;
        </Link>
      ) : (
        <span aria-hidden="true" className={DISABLED}>
          &rarr;
        </span>
      )}
    </nav>
  );
}
