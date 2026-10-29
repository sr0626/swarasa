"use client";

// Disclosure panel for the admin list pages' Summary strip and Search & filters
// form, so by default only a slim header row takes space above the table.
//
// - A single header <button> (the whole row is the target, >= 44px tall) with
//   aria-expanded + aria-controls; Enter / Space work natively.
// - COLLAPSED BY DEFAULT. The server render and first client render are
//   identical (collapsed, or open when `forceOpen`), so there is no hydration
//   mismatch; the remembered choice is read from localStorage in an effect
//   after mount. Every storage access is try/catch'd -- with storage blocked
//   the panel just starts collapsed and works for the session.
// - The body is rendered in the DOM and hidden with the `hidden` attribute (not
//   unmounted), so a search form keeps its state and still submits as a plain
//   GET. `forceOpen` (a filter is applied via the URL) opens the panel and
//   wins over the stored choice, so a filtered view never hides its filter.
// - No animation is required; the chevron's rotation transition is disabled
//   under prefers-reduced-motion.
// Only the open/closed flag is stored under a page+panel key (see
// lib/collapsiblePanel.ts) -- nothing sensitive.
import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { panelStorageKey, parseStoredOpen, storedValueFor } from "@/lib/collapsiblePanel";

export default function CollapsiblePanel({
  page,
  panel,
  title,
  hint,
  forceOpen = false,
  className = "mt-6",
  children,
}: {
  /** Page id for the storage key, e.g. "users". */
  page: string;
  /** Panel id for the storage key, e.g. "summary" | "search". */
  panel: string;
  title: string;
  /** Short glanceable text shown beside the title while collapsed. */
  hint?: string | null;
  /** Open on first render and ignore the stored choice (filters applied). */
  forceOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  const bodyId = useId();
  const storageKey = panelStorageKey(page, panel);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      return;
    }
    try {
      const stored = parseStoredOpen(window.localStorage.getItem(storageKey));
      if (stored !== null) setOpen(stored);
    } catch {
      // Storage unavailable (private mode, blocked): stay collapsed.
    }
  }, [forceOpen, storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, storedValueFor(next));
    } catch {
      // Not persisted; still toggles for this visit.
    }
  }

  return (
    <div
      className={`rounded-brand-card border border-brand-border bg-white shadow-brand-control ${className}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-brand-card px-4 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            {title}
          </span>
          {!open && hint && (
            <span className="min-w-0 break-words text-sm font-medium text-brand-ink">
              <span aria-hidden="true">&middot; </span>
              {hint}
            </span>
          )}
        </span>
        <ChevronDownIcon
          className={`h-5 w-5 shrink-0 text-brand-ink-subtle transition-transform motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div id={bodyId} hidden={!open} className="border-t border-brand-border px-4 pb-4 pt-3">
        {children}
      </div>
    </div>
  );
}
