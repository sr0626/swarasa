"use client";

// Deal-alerts bell for the shared TopBar (registered_user only): in-app
// notifications that a restaurant the diner follows added a deal
// (docs/API_CONTRACTS.md "Notifications"). Modeled on AdminNotificationsBell:
// the list + unread count are fetched server-side by components/home/TopBar.tsx
// on every page render (no polling), `data === null` means that fetch failed.
//
// Behaviour: tapping an alert marks it read (Server Action) and THEN navigates
// to the location page's deals section, so the next page's bell is already
// correct; a modified click (new tab) just marks it read. "Mark all as read"
// zeroes the badge. Updates are optimistic (lib/notifications/view.ts).
//
// Accessibility: disclosure button (aria-expanded/aria-controls) whose
// aria-label carries the unread count (the visual badge is aria-hidden);
// Escape closes and returns focus; outside click / tabbing out closes. Every
// tap target is >= 44px. Mobile (375px): below `sm:` the panel anchors to the
// full-width sticky header with 16px gutters, as the admin bell does.
import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type SVGProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LocalDateTime from "@/components/ui/LocalDateTime";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/actions/notifications";
import { announceMenuOpen, onOtherMenuOpen } from "@/lib/nav/exclusiveMenu";
import {
  badgeText,
  bellLabel,
  markAllReadLocally,
  markReadLocally,
  notificationHeadline,
  notificationHref,
  shouldInterceptClick,
  type BellState,
} from "@/lib/notifications/view";
import type { NotificationList } from "@/types/notification";

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

function stateFrom(data: NotificationList | null): BellState {
  return { items: data?.results ?? [], unread: data?.unread_count ?? 0 };
}

export default function DealAlertsBell({ data }: { data: NotificationList | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<BellState>(() => stateFrom(data));
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // A re-render of the server TopBar (navigation / revalidation) hands us fresh data.
  useEffect(() => {
    setState(stateFrom(data));
  }, [data]);

  // Only one top-bar menu open at a time: announce this one, close on another's.
  const menuId = useId();
  useEffect(() => {
    if (open) announceMenuOpen(menuId);
  }, [open, menuId]);
  useEffect(() => onOtherMenuOpen(menuId, () => setOpen(false)), [menuId]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: globalThis.MouseEvent) {
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

  async function handleAlertClick(
    e: MouseEvent<HTMLAnchorElement>,
    id: number,
    href: string,
    isUnread: boolean
  ) {
    const intercept = shouldInterceptClick(e);
    if (intercept) e.preventDefault();
    if (isUnread) {
      setState((prev) => markReadLocally(prev, id, new Date().toISOString()));
      // Awaited when we are navigating ourselves, so the next page's bell is fresh.
      const pending = markNotificationReadAction(id);
      if (intercept) await pending;
    }
    setOpen(false);
    if (intercept) router.push(href);
  }

  async function handleMarkAll() {
    setState((prev) => markAllReadLocally(prev, new Date().toISOString()));
    const result = await markAllNotificationsReadAction();
    // On failure, fall back to the server's truth on the next render.
    if (!result.ok) router.refresh();
  }

  const badge = badgeText(state.unread);

  return (
    <div ref={containerRef} className="sm:relative" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={bellLabel(state.unread)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex h-11 w-11 items-center justify-center rounded-brand-pill border border-brand-border bg-white text-brand-ink transition hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <BellIcon className="h-5 w-5" />
        {badge && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-brand-pill bg-brand-accent px-1 text-[11px] font-bold leading-none text-white"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Deal alerts"
          className="absolute inset-x-4 top-full z-50 mt-1 max-h-[80vh] overflow-y-auto rounded-brand-control border border-brand-border bg-white pb-2 shadow-brand-card-hover sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-80"
        >
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
              Deal alerts
            </h3>
            {state.unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                // -my-3: 44px tap height without growing the header row.
                className="-my-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-end text-xs font-semibold text-brand-accent hover:text-brand-accent-hover focus:underline focus:outline-none"
              >
                Mark all as read
              </button>
            )}
          </div>

          {!data ? (
            <p className="px-4 py-4 text-sm text-brand-ink-muted">
              Deal alerts are unavailable right now. Try again after reloading the page.
            </p>
          ) : state.items.length === 0 ? (
            <p className="px-4 py-4 text-sm text-brand-ink-muted">
              No deal alerts yet. Follow a restaurant and we&apos;ll tell you here when it posts a deal.
            </p>
          ) : (
            <ul>
              {state.items.map((n) => {
                const unread = n.read_at === null;
                const href = notificationHref(n);
                return (
                  <li key={n.id}>
                    <Link
                      href={href}
                      onClick={(e) => handleAlertClick(e, n.id, href, unread)}
                      className="flex min-h-[44px] items-start gap-3 px-4 py-2 text-sm text-brand-ink transition hover:bg-brand-chip focus:bg-brand-chip focus:outline-none"
                    >
                      {/* Unread marker: a dot, plus the "Unread" text for screen readers
                          (never colour alone). */}
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-brand-accent" : "bg-transparent"}`}
                      />
                      {unread && <span className="sr-only">Unread: </span>}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${unread ? "font-semibold" : "font-medium"}`}>
                          {notificationHeadline(n)}
                        </span>
                        <span className="block truncate text-xs text-brand-ink-muted">
                          {n.title}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-brand-ink-subtle">
                        <LocalDateTime value={n.created_at} variant="shortDate" fallback="" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
