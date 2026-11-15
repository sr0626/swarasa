// Root layout — HTML shell, font loading, and metadata boilerplate.
//
// Visual direction "Spice Market" is picked (see tailwind.config.ts header
// comment) — the two typefaces it specifies (Space Grotesk / Manrope, both
// SIL OFL) are self-hosted via `next/font/local` from WOFF2 files committed
// under `./fonts/` (latin subset, variable `wght` axis, licenses alongside).
// They used to come from `next/font/google`, which fetches the font CSS from
// Google at BUILD time; that fetch intermittently returned an unusable
// response on the Amplify builder and failed the whole build. Local files
// remove that external dependency from the build path with no visual change.
// They are exposed as CSS custom properties that
// `tailwind.config.ts`'s `fontFamily.display` / `fontFamily.body` tokens
// point at. Components never reference "Space Grotesk" / "Manrope" by
// literal name — only the `font-display` / `font-body` utility classes.
import type { Metadata } from "next";
import localFont from "next/font/local";
import { SITE_URL } from "@/lib/site";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";
import Footer from "@/components/layout/Footer";
import "./globals.css";

// Variable fonts (single WOFF2 each, `wght` axis): Space Grotesk 300-700,
// Manrope 200-800 — covers every weight the site uses (display 500/700,
// body 400/500/600/700). `adjustFontFallback` generates a size-adjusted
// fallback face so the swap causes no layout shift.
const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  style: "normal",
  variable: "--font-display",
  display: "swap",
  adjustFontFallback: "Arial",
});

const manrope = localFont({
  src: "./fonts/manrope/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-body",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  // Required for relative `alternates.canonical` paths (e.g.
  // "/restaurant/{slug}" in app/restaurant/[brandSlug]/page.tsx) to resolve to
  // real absolute URLs (frontend/CLAUDE.md "Canonical URLs on all pages").
  metadataBase: new URL(SITE_URL),
  title: {
    default: `Swarasa — Discover Your Taste, ${DEFAULT_CITY_LABEL}`,
    template: "%s | Swarasa",
  },
  description:
    `Discover your taste across ${DEFAULT_CITY_LABEL} — verified restaurants, filtered by regional cuisine and dietary needs, with deals from registered restaurants.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${manrope.variable}`}>
      <body className="font-body bg-brand-bg text-brand-ink antialiased">
        {children}
        <Footer />
      </body>
    </html>
  );
}
