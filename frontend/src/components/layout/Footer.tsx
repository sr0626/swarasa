// Site-wide footer — wired into the root layout (see app/layout.tsx) so it
// renders on every page. No footer component existed before this change
// (checked components/home, components/ui — TopBar had nav links but
// nothing linked back down to it, which is why /about, /contact, and
// /terms had nowhere to surface from).
//
// Kept deliberately minimal per frontend/CLAUDE.md's Tailwind-tokens-only,
// mobile-first rules: wordmark + tagline, the three informational links,
// and a copyright line. No social links — none are decided anywhere in the
// repo (checked docs/BRD_v36_Restaurant_Platform.docx and DECISIONS.md), so
// none are fabricated here.
import Link from "next/link";
import SwarasaMark from "@/components/icons/SwarasaMark";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";

const FOOTER_LINKS = [
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
  { href: "/terms", label: "Terms & Privacy" },
] as const;

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-brand-border bg-brand-bg">
      {/* Same container as TopBarShell and page content (max-w-6xl, px-4 /
          sm:px-6) so left/right edges line up at every breakpoint. */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:py-10">
          <div className="flex flex-col gap-1 leading-tight">
            <span className="flex items-center gap-1.5 font-display text-lg font-bold text-brand-ink">
              <SwarasaMark className="h-4 w-auto text-brand-accent" />
              Swarasa
            </span>
            <span className="text-xs text-brand-ink-subtle">
              Discover Your Taste — {DEFAULT_CITY_LABEL}
            </span>
          </div>

          <nav
            aria-label="Footer"
            className="-my-2 flex flex-wrap items-center gap-x-6 text-sm font-medium text-brand-ink-muted sm:my-0"
          >
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-[44px] items-center transition hover:text-brand-ink sm:min-h-0"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="border-t border-brand-border py-4 text-xs text-brand-ink-subtle">
          &copy; {year} Swarasa. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
