"use client";

// Invisible client-side tracker for one public location page: reports a page
// view after load, a "deals section seen" event when the #deals section
// scrolls into view, and clicks on any link tagged `data-track="website" |
// "directions" | "phone"` (RestaurantInfoCard). Renders nothing.
//
// Why client-side: the page is server-rendered/cached; counting from the
// browser after load means SSR/ISR caching is untouched and crawlers that
// don't run JS are (mostly) not counted. Everything is a best-effort beacon
// (lib/analytics/track.ts) and never delays or breaks the page.
//
// `suppress` is true for the location's own owner/manager and admins, whose
// views are not counted (the backend re-checks this server-side from the
// relayed session, so this is only a round-trip saver).
import { useEffect } from "react";
import {
  LINK_EVENTS,
  onceKey,
  shouldCountOnce,
  trackLocationEvent,
} from "@/lib/analytics/track";
import { DEALS_SECTION_ID } from "@/lib/deals/format";
import type { TrackEvent } from "@/types/analytics";

function sessionStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export default function LocationTracker({
  locationId,
  suppress,
}: {
  locationId: number;
  suppress: boolean;
}) {
  useEffect(() => {
    if (suppress) return;
    const store = sessionStore();
    const countOnce = (event: TrackEvent) => {
      if (shouldCountOnce(store, onceKey(locationId, event))) trackLocationEvent(locationId, event);
    };

    countOnce("page_view");

    let observer: IntersectionObserver | undefined;
    const dealsEl = document.getElementById(DEALS_SECTION_ID);
    if (dealsEl && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            countOnce("deal_view");
            observer?.disconnect();
          }
        },
        { threshold: 0.4 }
      );
      observer.observe(dealsEl);
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLElement>("[data-track]");
      const event = link ? LINK_EVENTS[link.dataset.track ?? ""] : undefined;
      if (event) trackLocationEvent(locationId, event);
    };
    document.addEventListener("click", onClick, true);

    return () => {
      observer?.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, [locationId, suppress]);

  return null;
}
