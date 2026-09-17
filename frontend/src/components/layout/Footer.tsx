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

const FOOTER_LINKS = [
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
  { href: "/terms", label: "Terms & Privacy" },
] as const;

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-brand-border bg-brand-bg">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex flex-col leading-tight">
          <span className="flex items-center gap-1.5 font-display text-lg font-bold text-brand-ink">
            <SwarasaMark className="h-4 w-auto text-brand-accent" />
            Swarasa
          </span>
          <span className="mt-1 text-xs text-brand-ink-subtle">
            Discover Your Taste — Dallas-Fort Worth
          </span>
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-brand-ink-muted"
        >
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="min-h-[44px] py-2.5 transition hover:text-brand-ink sm:min-h-0 sm:py-0"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="border-t border-brand-border px-4 py-4 text-center text-xs text-brand-ink-subtle sm:px-6">
        &copy; {year} Swarasa. All rights reserved.
      </div>
    </footer>
  );
}
