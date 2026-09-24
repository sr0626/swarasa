"use client";

// "Deals · Menu · Hours" jump-link row under the restaurant name on a location
// page. Only the sections that exist for the location are passed in (see
// lib/restaurant/jumpLinks.ts), so every link lands somewhere; renders nothing
// when there are none.
//
// Plain in-page anchors (`<a href="#menu">`): works without JS, keeps the URL
// hash, native fragment navigation for keyboard/AT users. Smooth scrolling is
// applied by toggling `scroll-behavior` on <html> around the click — only when
// the visitor has NOT asked for reduced motion — the same approach as the
// editor's EditorSectionNav, so native focus/hash behaviour is untouched.
// Targets carry `scroll-mt-24` so they clear the sticky top bar.
//
// Mobile (375px): a single row that scrolls horizontally inside its own
// container (the page never scrolls sideways); each pill is a 44px-tall touch
// target.
import type { JumpLinkItem } from "@/lib/restaurant/jumpLinks";

export default function JumpLinks({ links }: { links: readonly JumpLinkItem[] }) {
  if (links.length === 0) return null;

  function handleClick() {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    root.style.scrollBehavior = reduce ? "auto" : "smooth";
    window.setTimeout(() => root.style.removeProperty("scroll-behavior"), 900);
  }

  return (
    <nav aria-label="Jump to a section of this page">
      <ul className="flex items-center gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {links.map((link) => (
          <li key={link.id} className="shrink-0">
            <a
              href={link.href}
              onClick={handleClick}
              className="flex min-h-[44px] items-center rounded-brand-pill border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink-muted transition hover:bg-brand-chip hover:text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
