// Site-wide footer — wired into the root layout (see app/layout.tsx) so it
// renders on every page.
//
// Kept deliberately minimal per frontend/CLAUDE.md's Tailwind-tokens-only,
// mobile-first rules: the three informational links and a copyright line.
// The brand block (logo + wordmark + tagline) was removed 2026-09-24 (direct
// user feedback — the header already carries the brand). No social links —
// none are decided anywhere in the repo, so none are fabricated here.
import Link from "next/link";
import { FOOTER_LINKS } from "./footerLinks";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-brand-border bg-brand-bg">
      {/* Same container as TopBarShell and page content (max-w-6xl, px-4 /
          sm:px-6) so left/right edges line up at every breakpoint. One row
          from sm up (links left, copyright right); stacked and left-aligned
          on a phone. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-5">
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center gap-x-6 text-sm font-medium text-brand-ink-muted"
          >
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-[44px] items-center transition hover:text-brand-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <p className="pb-2 text-xs text-brand-ink-subtle sm:pb-0">
            &copy; {year} Swarasa. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
