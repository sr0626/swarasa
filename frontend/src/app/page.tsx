// Homepage — "Spice Market" visual direction (picked 2026-09-13 from a
// 12-option design canvas; see docs/homepage-direction-spice-market and
// tailwind.config.ts's header comment for the token scheme this page is
// built on). Every color/font/radius/shadow below is a Tailwind token
// (`bg-brand-*`, `text-brand-*`, `font-display`, `rounded-brand-*`,
// `shadow-brand-*`) — no literal hex code or font-family string lives in
// this file, so a future rebrand only touches tailwind.config.ts/globals.css.
import type { Metadata } from "next";
import { Suspense } from "react";
import TopBar from "@/components/home/TopBar";
import Hero from "@/components/home/Hero";
import PopularNearYou from "@/components/home/PopularNearYou";
import PopularNearYouSkeleton from "@/components/home/PopularNearYouSkeleton";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";

export const metadata: Metadata = {
  title: `Discover Your Taste — ${DEFAULT_CITY_LABEL}`,
  description:
    `Discover your taste across ${DEFAULT_CITY_LABEL} — verified restaurants, filtered by regional cuisine and dietary needs.`,
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <Hero />

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <h2 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          Popular near you
        </h2>
        <p className="mt-1 text-sm text-brand-ink-muted">
          Verified restaurants around {DEFAULT_CITY_LABEL}.
        </p>

        <div className="mt-6">
          <Suspense fallback={<PopularNearYouSkeleton />}>
            <PopularNearYou />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
