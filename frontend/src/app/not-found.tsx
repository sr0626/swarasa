// Shown for an unknown address, and when a page calls notFound() (a hidden or
// removed listing). Next's built-in version has no header and no way back.
import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/home/TopBar";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <div className="mx-auto flex max-w-6xl justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md rounded-brand-card border border-brand-border bg-white p-6 text-center shadow-brand-card sm:p-8">
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            We couldn&apos;t find that page
          </h1>
          <p className="mt-2 text-sm text-brand-ink-muted">
            The address may be wrong, or the listing is no longer available.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/search"
              className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-4 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
            >
              Find restaurants
            </Link>
            <Link
              href="/"
              className="flex min-h-[44px] items-center justify-center rounded-brand-control border border-brand-border px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-bg"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
