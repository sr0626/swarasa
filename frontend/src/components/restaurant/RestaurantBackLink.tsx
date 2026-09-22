"use client";

// The public restaurant page is reachable from a lot of places -- search
// results, the homepage, a signed-in user's follows list, the admin
// listings/claims queues, a shared link -- so there's no single correct
// "back" destination. This renders a plain `Link` to `/search` (the
// always-valid fallback) for the server render and the client's first
// paint, which keeps hydration consistent (no window/document access
// during render). Once mounted, if real browser history exists AND the
// referrer that sent the visitor here was this same site (so "back" can
// never strand someone off-site or on an unrelated stale tab), it swaps
// to a button that calls `router.back()` instead -- that preserves
// whatever scroll position and filter state the actual previous page
// had, rather than always resetting to a fresh, unfiltered /search.
//
// A small client island deliberately kept out of `page.tsx` itself so
// the rest of that page stays a server component (SSR is non-negotiable
// for this route -- frontend/CLAUDE.md "SEO Requirements").
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@/components/ui/icons";

// Shared so the button and the fallback link render identically (same
// height/padding/type), only the tag and click behavior differ. 44px
// minimum touch target per frontend/CLAUDE.md "Mobile-First Rules".
const LINK_CLASSES =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-brand-pill px-2 text-sm font-semibold text-brand-ink-muted transition hover:text-brand-ink";

export default function RestaurantBackLink() {
  const router = useRouter();
  const [canUseHistory, setCanUseHistory] = useState(false);

  useEffect(() => {
    try {
      const hasHistory = window.history.length > 1;
      const referrer = document.referrer;
      const referrerIsSameOrigin =
        referrer.length > 0 && new URL(referrer).origin === window.location.origin;
      setCanUseHistory(hasHistory && referrerIsSameOrigin);
    } catch {
      // Malformed/unreadable referrer (e.g. a browser privacy setting) --
      // fall back to the /search link, same as no referrer at all.
      setCanUseHistory(false);
    }
  }, []);

  if (canUseHistory) {
    return (
      <button type="button" onClick={() => router.back()} className={LINK_CLASSES}>
        <ArrowLeftIcon className="h-4 w-4" />
        Back
      </button>
    );
  }

  return (
    <Link href="/search" className={LINK_CLASSES}>
      <ArrowLeftIcon className="h-4 w-4" />
      Back to search
    </Link>
  );
}
