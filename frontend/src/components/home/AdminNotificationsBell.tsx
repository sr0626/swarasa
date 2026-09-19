"use client";

// Admin-only notifications bell for the shared TopBar. Purely presentational:
// the data is fetched server-side by components/home/TopBar.tsx
// (`GET /admin/notifications`) on every page render, so it refreshes on
// navigation with no polling, websocket or client-side fetch. `data === null`
// means that fetch failed -- the bell still renders (so an admin knows it's
// there) with a short "unavailable" note instead of a count.
//
// Accessibility: a disclosure button (aria-expanded/aria-controls) whose
// aria-label carries the count; Escape closes and returns focus to the
// button; clicking outside or tabbing out closes it. The badge is
// aria-hidden because the label already announces the count.
//
// Mobile (375px): below `sm:` the panel anchors to the (full-width, sticky)
// header with 16px gutters rather than to the bell, which sits left of the
// account menu and would otherwise push a 320px panel off-screen.
import { useEffect, useId, useRef, useState, type FocusEvent, type SVGProps } from "react";
import Link from "next/link";
import type { AdminNotifications } from "@/types/adminNotifications";
import type { ReportCategory } from "@/types/listingReport";

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  address_incorrect: "Wrong address",
  hours_incorrect: "Wrong hours",
  phone_incorrect: "Wrong phone",
  price_incorrect: "Wrong prices",
  menu_incorrect: "Wrong menu",
  permanently_closed: "Permanently closed",
  other: "Other",
};

// Fixed UTC "Sep 18" -- avoids server/client timezone hydration mismatches.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function SectionHeader({
  title,
  count,
  href,
}: {
  title: string;
  count: number;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
        {title} ({count})
      </h3>
      {href && count > 0 && (
        <Link
          href={href}
          className="text-xs font-semibold text-brand-accent hover:text-brand-accent-hover focus:underline focus:outline-none"
        >
          View all
        </Link>
      )}
    </div>
  );
}

const ROW_CLASS =
  "flex min-h-[44px] items-center justify-between gap-3 px-4 py-2 text-sm text-brand-ink";
const LINK_ROW_CLASS = `${ROW_CLASS} transition hover:bg-brand-chip focus:bg-brand-chip focus:outline-none`;

export default function AdminNotificationsBell({ data }: { data: AdminNotifications | null }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const total = data?.total ?? 0;
  const label = data
    ? total > 0
      ? `Notifications, ${total} need${total === 1 ? "s" : ""} attention`
      : "Notifications, nothing needs attention"
    : "Notifications, unavailable";

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  }

  const closeOnNavigate = () => setOpen(false);

  return (
    <div ref={containerRef} className="sm:relative" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex h-11 w-11 items-center justify-center rounded-brand-pill border border-brand-border bg-white text-brand-ink transition hover:bg-brand-chip"
      >
        <BellIcon className="h-5 w-5" />
        {total > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-brand-pill bg-brand-accent px-1 text-[11px] font-bold leading-none text-white"
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Admin notifications"
          className="absolute inset-x-4 top-full z-50 mt-1 max-h-[80vh] overflow-y-auto rounded-brand-control border border-brand-border bg-white pb-2 shadow-brand-card-hover sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-80"
        >
          {!data ? (
            <p className="px-4 py-4 text-sm text-brand-ink-muted">
              Notifications are unavailable right now. Try again after reloading the page.
            </p>
          ) : (
            <>
              <SectionHeader title="Pending claims" count={data.claims.count} href="/admin/claims" />
              {data.claims.items.length === 0 ? (
                <p className="px-4 py-2 text-sm text-brand-ink-subtle">No pending claims.</p>
              ) : (
                <ul>
                  {data.claims.items.map((c) => (
                    <li key={c.claim_id}>
                      <Link href="/admin/claims" onClick={closeOnNavigate} className={LINK_ROW_CLASS}>
                        <span className="min-w-0 truncate font-medium">{c.brand_name}</span>
                        <span className="shrink-0 text-xs text-brand-ink-subtle">
                          {formatDate(c.submitted_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <SectionHeader title="Open reports" count={data.reports.count} href="/admin/reports" />
              {data.reports.items.length === 0 ? (
                <p className="px-4 py-2 text-sm text-brand-ink-subtle">No open reports.</p>
              ) : (
                <ul>
                  {data.reports.items.map((r) => (
                    <li key={r.report_id}>
                      <Link href="/admin/reports" onClick={closeOnNavigate} className={LINK_ROW_CLASS}>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.brand_name}</span>
                          <span className="block truncate text-xs text-brand-ink-muted">
                            {CATEGORY_LABELS[r.category] ?? r.category}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-brand-ink-subtle">
                          {formatDate(r.submitted_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {/* No admin user-management page exists yet, so these rows are
                  informational (not links). */}
              <SectionHeader
                title={`New owners, last ${data.new_users_window_days} days`}
                count={data.new_users.count}
              />
              {data.new_users.items.length === 0 ? (
                <p className="px-4 py-2 text-sm text-brand-ink-subtle">No new sign-ups.</p>
              ) : (
                <ul>
                  {data.new_users.items.map((u) => (
                    <li key={u.owner_id} className={ROW_CLASS}>
                      <span className="min-w-0 truncate">{u.display}</span>
                      <span className="shrink-0 text-xs text-brand-ink-subtle">
                        {formatDate(u.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
