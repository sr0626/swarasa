// Root layout — HTML shell, font loading, and metadata boilerplate.
//
// Visual direction "Spice Market" is picked (see tailwind.config.ts header
// comment) — the two Google Fonts it specifies are loaded here via
// `next/font/google` (the idiomatic Next.js way: self-hosted at build time,
// no layout-shifting <link> tag) and exposed as CSS custom properties that
// `tailwind.config.ts`'s `fontFamily.display` / `fontFamily.body` tokens
// point at. Components never reference "Space Grotesk" / "Manrope" by
// literal name — only the `font-display` / `font-body` utility classes.
import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";
import Footer from "@/components/layout/Footer";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
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
