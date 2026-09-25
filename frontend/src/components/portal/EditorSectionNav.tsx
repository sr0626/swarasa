"use client";

// Sticky "jump to section" row for the location editor
// (/portal/locations/[id]/page.tsx stays a server component; only this row is
// client-side, for the active-section highlight).
//
// Plain in-page anchors (`<a href="#deals">`) so it works without JS, keeps
// the URL hash, and keyboard/AT users get native fragment navigation. Smooth
// scrolling is applied by toggling `scroll-behavior` on <html> around the
// click (only when the user hasn't asked for reduced motion) instead of
// intercepting the click, so native focus/hash behaviour is untouched.
//
// Sticky offset: on `md` and up the site header (TopBarShell) is `sticky top-0`,
// so this row sits directly under it; below `md` the editor renders the header
// non-sticky (TopBar `stickyOnMobile={false}`) to give the form back ~77px of a
// phone screen, so this row sticks at the very top there. The header's real
// sticky height (0 when it is not sticky) is measured and published as
// `--editor-topbar-h` on <html>, which both this row's `top` and every target's
// `scroll-margin-top` (editorSectionAnchor.ts) read -- no hard-coded header
// height to drift. Before hydration the CSS fallbacks (0px / 73px) apply.
//
// The "Back to ..." link is folded into this same sticky bar (left of the
// section links, outside the scrolling list) so it stays reachable however
// far the page is scrolled. The bar is a single fixed-height row (48px on a
// phone, 56px from `md`), so the scroll-margin (editorSectionAnchor.ts) and the
// reading line below track it.
//
// Mobile (375px): the list scrolls horizontally inside its own container
// (`overflow-x-auto`, page itself never scrolls sideways); each link is a
// 44px-tall touch target; the row is a fixed height, so nothing shifts.
//
// Active section: see lib/portal/activeSection.ts -- the last section whose top
// has passed the reading line under the sticky stack (and the final section
// when scrolled to the page bottom).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { centerScrollLeft } from "@/lib/ui/horizontalScroll";
import { isAtPageBottom, pickActiveSectionId } from "@/lib/portal/activeSection";
import type { EditorSection } from "@/lib/portal/editorSections";

/** Height of the site header while it is sticky (0 when it scrolls away, as on phones in the editor). */
function stickyHeaderHeight(): number {
  const header = document.querySelector("header");
  if (!header) return 0;
  return window.getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().height : 0;
}

export default function EditorSectionNav({
  sections,
  backHref,
  backLabel,
  backShortLabel,
}: {
  sections: readonly EditorSection[];
  /** Where "back" goes (role-dependent). */
  backHref: string;
  /** Full accessible name, e.g. "Back to your locations". */
  backLabel: string;
  /** Compact visible text after the arrow, e.g. "Locations". */
  backShortLabel: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Where a jump link left the page once its scroll settled (see `update`).
  const settledRef = useRef<{ id: string; y: number } | null>(null);
  // While a click-initiated smooth scroll runs, the observer would flicker the
  // highlight through every section on the way; pin the clicked one until the
  // scroll settles.
  const pinnedRef = useRef<string | null>(null);

  // Publish the sticky header height as a CSS variable.
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--editor-topbar-h", `${stickyHeaderHeight()}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    // The header turns sticky/static at the `md` breakpoint without changing size.
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--editor-topbar-h");
    };
  }, []);

  // Highlight the section the reader is in (see lib/portal/activeSection.ts).
  useEffect(() => {
    const ids = sections.map((s) => s.anchorId);
    if (ids.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      if (pinnedRef.current) return;
      // A jump link settled here: keep its section highlighted until the page moves.
      const settled = settledRef.current;
      if (settled && Math.abs(window.scrollY - settled.y) <= 3) {
        setActiveId(settled.id);
        return;
      }
      settledRef.current = null;
      const positions = ids.flatMap((id) => {
        const el = document.getElementById(id);
        return el ? [{ id, top: el.getBoundingClientRect().top }] : [];
      });
      // Reading line: just under the sticky stack (header when sticky + this row +
      // the Go-live bar, which is server-rendered so already in the DOM).
      const goLiveH = document.querySelector<HTMLElement>("[data-go-live-bar]")?.offsetHeight ?? 0;
      const line = stickyHeaderHeight() + (rootRef.current?.offsetHeight ?? 0) + goLiveH + 24;
      setActiveId(
        pickActiveSectionId({
          positions,
          line,
          viewportHeight: window.innerHeight,
          atPageBottom: isAtPageBottom(window.scrollY, window.innerHeight, document.documentElement.scrollHeight),
        })
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const initialHash = window.location.hash.slice(1);
    if (initialHash && ids.includes(initialHash)) setActiveId(initialHash);
    else schedule();

    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [sections]);

  // Keep the highlighted link visible inside the horizontally scrolling row.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) return;
    const link = list.querySelector<HTMLElement>(`[data-anchor="${activeId}"]`);
    if (!link) return;
    // The <ul> is `relative`, so offsetLeft is measured from the list itself
    // (not from the sticky bar, which also holds the Back link).
    list.scrollTo({
      left: centerScrollLeft(link.offsetLeft, link.offsetWidth, list.clientWidth, list.scrollWidth),
      behavior: "auto",
    });
  }, [activeId]);

  function handleClick(anchorId: string) {
    setActiveId(anchorId);
    pinnedRef.current = anchorId;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    root.style.scrollBehavior = reduce ? "auto" : "smooth";
    settledRef.current = null;
    window.setTimeout(() => {
      root.style.removeProperty("scroll-behavior");
      pinnedRef.current = null;
      settledRef.current = { id: anchorId, y: window.scrollY };
    }, 900);
  }

  return (
    // -mx-4/-mx-6 + matching padding: the row spans the page's padded column
    // edge to edge so scrolled content doesn't peek out beside it.
    <div
      ref={rootRef}
      className="sticky top-[var(--editor-topbar-h,0px)] z-30 -mx-4 flex h-12 items-center gap-1 border-b border-brand-border bg-brand-bg/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 md:top-[var(--editor-topbar-h,73px)] md:h-14"
    >
      <Link
        href={backHref}
        aria-label={backLabel}
        className="flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-brand-pill pl-1 pr-3 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <span aria-hidden="true">&larr;</span>
        {backShortLabel}
      </Link>
      <span aria-hidden="true" className="h-6 w-px shrink-0 bg-brand-border" />
    <nav
      aria-label="Jump to a section of this listing"
      className="min-w-0 flex-1"
    >
      <ul ref={listRef} className="relative flex h-12 items-center gap-1 overflow-x-auto md:h-14 overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => {
          const active = activeId === s.anchorId;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.anchorId}`}
                data-anchor={s.anchorId}
                aria-current={active ? "location" : undefined}
                onClick={() => handleClick(s.anchorId)}
                className={
                  "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-brand-pill px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent " +
                  (active
                    ? "bg-brand-ink text-brand-bg"
                    : "text-brand-ink-muted hover:bg-brand-chip hover:text-brand-ink")
                }
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
    </div>
  );
}
