// Search box + sort menu + page links shared by the server-driven admin list
// reports (Registered users, Managers). Plain GET form and plain links -- no
// client state, works without JavaScript. Mobile-first: the form stacks on a
// 375px screen with 44px-tall controls; nothing here can force horizontal
// page scroll.
import type { ReactNode } from "react";
import Link from "next/link";

const CONTROL =
  "mt-1 min-h-[44px] w-full rounded-brand-control border border-brand-border bg-white px-3 text-sm text-brand-ink";

interface SortOption {
  value: string;
  label: string;
}

export function AdminReportSearchForm({
  action,
  idPrefix,
  q,
  sort,
  defaultSort,
  sortOptions,
  placeholder,
}: {
  action: string;
  idPrefix: string;
  q: string | undefined;
  sort: string;
  defaultSort: string;
  sortOptions: ReadonlyArray<SortOption>;
  placeholder: string;
}) {
  return (
    <form
      method="get"
      action={action}
      role="search"
      className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="sm:min-w-[220px] sm:flex-1">
        <label
          htmlFor={`${idPrefix}-q`}
          className="block text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle"
        >
          Search
        </label>
        <input
          id={`${idPrefix}-q`}
          name="q"
          type="search"
          defaultValue={q ?? ""}
          maxLength={100}
          placeholder={placeholder}
          className={CONTROL}
        />
      </div>
      <div className="sm:w-48">
        <label
          htmlFor={`${idPrefix}-sort`}
          className="block text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle"
        >
          Sort by
        </label>
        <select id={`${idPrefix}-sort`} name="sort" defaultValue={sort} className={CONTROL}>
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="min-h-[44px] flex-1 rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:opacity-90 sm:flex-none"
        >
          Apply
        </button>
        {(q || sort !== defaultSort) && (
          <Link
            href={action}
            className="flex min-h-[44px] items-center px-2 text-sm text-brand-ink-muted underline-offset-2 hover:underline"
          >
            Reset
          </Link>
        )}
      </div>
    </form>
  );
}

export function AdminReportPager({
  label,
  page,
  totalPages,
  hrefFor,
}: {
  label: string;
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="mt-6 flex items-center justify-center gap-3 text-sm">
      <PageLink href={hrefFor(page - 1)} disabled={page <= 1}>
        &larr; Previous
      </PageLink>
      <span className="text-brand-ink-subtle">
        Page {page} of {totalPages}
      </span>
      <PageLink href={hrefFor(page + 1)} disabled={page >= totalPages}>
        Next &rarr;
      </PageLink>
    </nav>
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
  const base =
    "flex min-h-[44px] items-center rounded-brand-control border border-brand-border px-4";
  if (disabled) {
    return <span className={`${base} text-brand-ink-subtle/40`}>{children}</span>;
  }
  return (
    <Link href={href} className={`${base} text-brand-ink-muted transition hover:bg-brand-chip`}>
      {children}
    </Link>
  );
}
