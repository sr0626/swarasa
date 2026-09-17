"use client";

// App Router error boundary (Next.js convention: catches any unhandled
// error thrown while rendering a route segment). Found missing while
// testing the restaurant detail page locally — a page-level data-fetch
// failure (e.g. `loadRestaurantPageData`'s re-thrown non-404 ApiError)
// was falling through to Next.js's raw default error screen instead of
// the same graceful, branded degradation every other page already has
// (see PopularNearYou.tsx / InfoPanel.tsx) — inconsistent with
// frontend/CLAUDE.md's "ALWAYS handle API errors gracefully" guardrail.
import { useEffect } from "react";
import TopBarShell from "@/components/home/TopBarShell";
import InfoPanel from "@/components/ui/InfoPanel";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-brand-bg">
      {/* Signed-out-style header only (docs/PROJECT_PLAN.csv "Signed-in
          account dropdown in site header" — see TopBar.tsx/TopBarShell.tsx
          header comments): this boundary is a required Client Component and
          can't safely re-derive the session mid-error anyway, so it never
          renders the account menu here even for a signed-in visitor. */}
      <TopBarShell greetingName={null} />
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <InfoPanel
          title="Something went wrong"
          body="We hit a snag loading this page. Check back shortly, or try again."
        />
        <button
          type="button"
          onClick={reset}
          className="mx-auto mt-6 flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
