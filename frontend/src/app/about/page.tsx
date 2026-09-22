// About Us — static marketing/informational page (not a legal document, so
// real finished copy is appropriate here per this task's brief). SSR by
// default (App Router server component, no "use client"), matching the
// SSR-for-SEO-relevant-pages convention used by the homepage and the
// public restaurant listing page (frontend/CLAUDE.md "Key Patterns").
//
// Copy is drawn from root CLAUDE.md's project description and
// docs/BRD_v36_Restaurant_Platform.docx sections 1 (Executive Summary) and
// 2 (Objectives) — regional cuisine filters, verified/owner-managed
// listings, deals, DFW launch market — no invented product claims.
import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/home/TopBar";
import { DEFAULT_CITY_LABEL } from "@/lib/constants/city";

export const metadata: Metadata = {
  title: "About Us",
  description:
    `Swarasa is a location-based discovery platform for desi restaurants across ${DEFAULT_CITY_LABEL}, built around regional cuisine filters, verified listings, and owner-managed menus.`,
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-accent">
          About Us
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Discover Your Taste
        </h1>

        <div className="mt-6 flex flex-col gap-6 text-base leading-relaxed text-brand-ink-muted">
          <p>
            Swarasa is a location-based discovery platform built for one
            purpose: helping people across {DEFAULT_CITY_LABEL} find the
            desi food they&apos;re actually craving. Generic search and review
            apps flatten a huge, regionally diverse cuisine into a single
            category. Swarasa doesn&apos;t &mdash; you can filter by regional
            cuisine, dietary needs, and craving, and get to a verified
            restaurant that fits, not just a list of &quot;desi
            restaurants near me.&quot;
          </p>

          <p>
            Every listing on Swarasa is either verified by our team or
            claimed and managed directly by the restaurant that owns it.
            Owners and their assigned managers keep hours, photos, and menu
            details current themselves, so what you see is what the
            restaurant wants you to see &mdash; not a stale scrape from
            somewhere else.
          </p>

          <p>
            We&apos;re starting right here in {DEFAULT_CITY_LABEL}, with a
            directory of verified restaurants, geo-based search, and an
            owner portal that makes it easy for a restaurant to claim and
            maintain its own listing. Time-limited deals, richer owner
            tools, and support for more cities are on the way as the
            platform grows.
          </p>

          <p>
            Have a restaurant to suggest, or run one yourself? Visit our{" "}
            <Link
              href="/contact"
              className="font-semibold text-brand-ink underline underline-offset-2"
            >
              Contact Us
            </Link>{" "}
            page, or search for your restaurant and use the &quot;Claim this
            restaurant&quot; button on its listing page.
          </p>
        </div>
      </section>
    </main>
  );
}
