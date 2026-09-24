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
// Sticky offset: the site header (TopBarShell) is `sticky top-0`, so this row
// sits directly under it. The header's real height is measured and published
// as `--editor-topbar-h` on <html>, which both this row's `top` and every
// target's `scroll-margin-top` (editorSectionAnchor.ts) read -- no hard-coded
// header height to drift. Before hydration the CSS fallback (73px) applies.
//
// The "Back to ..." link is folded into this same sticky bar (left of the
// section links, outside the scrolling list) so it stays reachable however
// far the page is scrolled. The bar is a single fixed-height row, so the
// scroll-margin (editorSectionAnchor.ts) and the observer band below are
// unchanged by it.
//
// Mobile (375px): the list scrolls horizontally inside its own container
// (`overflow-x-auto`, page itself never scrolls sideways); each link is a
// 44px-tall touch target; the row is a fixed height, so nothing shifts.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { EditorSection } from "@/lib/portal/editorSections";

const NAV_HEIGHT_PX = 56; // matches h-14 below; used for the observer's top margin

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
  // While a click-initiated smooth scroll runs, the observer would flicker the
  // highlight through every section on the way; pin the clicked one until the
  // scroll settles.
  const pinnedRef = useRef<string | null>(null);

  // Publish the sticky header height as a CSS variable.
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--editor-topbar-h", `${header.getBoundingClientRect().height}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--editor-topbar-h");
    };
  }, []);

  // Highlight the section whose top has passed under the sticky stack.
  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.anchorId))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;

    const headerH = document.querySelector("header")?.getBoundingClientRect().height ?? 73;
    // The Go-live bar (setup only) is server-rendered, so it's already in the
    // DOM here; it stacks under this row and shifts the band down by its height.
    const goLiveH = document.querySelector<HTMLElement>("[data-go-live-bar]")?.offsetHeight ?? 0;
    const topOffset = Math.round(headerH + NAV_HEIGHT_PX + goLiveH + 8);
    const visible = new Set<string>();
    const pick = () => {
      if (pinnedRef.current) return;
      // First section (in page order) currently inside the observed band.
      const first = sections.find((s) => visible.has(s.anchorId));
      if (first) setActiveId(first.anchorId);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        pick();
      },
      // Band = from just under the sticky stack down to 55% up from the bottom.
      { rootMargin: `-${topOffset}px 0px -55% 0px`, threshold: 0 }
    );
    targets.forEach((t) => observer.observe(t));

    const initialHash = window.location.hash.slice(1);
    if (initialHash && sections.some((s) => s.anchorId === initialHash)) setActiveId(initialHash);

    return () => observer.disconnect();
  }, [sections]);

  // Keep the highlighted link visible inside the horizontally scrolling row.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeId) return;
    const link = list.querySelector<HTMLElement>(`[data-anchor="${activeId}"]`);
    if (!link) return;
    const left = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
    list.scrollTo({ left, behavior: "auto" });
  }, [activeId]);

  function handleClick(anchorId: string) {
    setActiveId(anchorId);
    pinnedRef.current = anchorId;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    root.style.scrollBehavior = reduce ? "auto" : "smooth";
    window.setTimeout(() => {
      root.style.removeProperty("scroll-behavior");
      pinnedRef.current = null;
    }, 900);
  }

  return (
    // -mx-4/-mx-6 + matching padding: the row spans the page's padded column
    // edge to edge so scrolled content doesn't peek out beside it.
    <div className="sticky top-[var(--editor-topbar-h,73px)] z-30 -mx-4 flex h-14 items-center gap-1 border-b border-brand-border bg-brand-bg/95 px-4 backdrop-blur sm:-mx-6 sm:px-6">
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
      <ul ref={listRef} className="flex h-14 items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
