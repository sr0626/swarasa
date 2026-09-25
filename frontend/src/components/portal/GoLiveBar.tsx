"use client";

// Sticky "Go live" bar on the location editor, shown while a listing is in
// setup (`coming_soon`, right after "Add restaurant" / "Add location"). It sits
// directly under the sticky section-nav (EditorSectionNav) so it stays in view
// however far the page is scrolled, and says two things at once:
//   - what is left ("2 things left: add phone, add hours", each a jump link to
//     the section that fixes it) or "All set — ready to go live"; and
//   - the big primary "Activate listing" button — disabled (with that same text
//     as its explanation) while anything is missing, enabled and pulsing for a
//     few seconds the moment the checklist is complete.
// The server stays the authority: `POST /locations/{id}/status` re-checks
// readiness (see ActivateListingButton). A manager sees the checklist but no
// button — only an owner/admin can activate.
//
// The bar publishes its own height as `--editor-golive-h` on <html> so the
// section anchors' scroll-margin (editorSectionAnchor.ts) clears it too.
//
// Phone (below `sm`): one compact row -- "2 things left" (a 44px link down to the
// full checklist banner, which has its own 44px "Add" links) + the Activate
// button -- so the pinned stack stays ~100px. From `sm` the individual
// "add phone / add hours" jump links are shown inline as before.
import { useEffect, useId, useRef, useState } from "react";
import ActivateListingButton from "@/components/portal/ActivateListingButton";
import { goLiveBarState } from "@/lib/portal/listingSetup";
import type { LocationStatus } from "@/types/location";

const EMPHASIS_MS = 6000;

export default function GoLiveBar({
  locationId,
  status,
  setupMissing,
  role,
}: {
  locationId: number;
  status: LocationStatus;
  setupMissing: string[];
  role: string;
}) {
  const state = goLiveBarState(status, setupMissing);
  const ready = state?.kind === "ready";
  const helpId = useId();
  const barRef = useRef<HTMLDivElement>(null);
  const [emphasize, setEmphasize] = useState(false);

  // A few seconds of emphasis whenever the checklist becomes complete.
  useEffect(() => {
    if (!ready) {
      setEmphasize(false);
      return;
    }
    setEmphasize(true);
    const timer = window.setTimeout(() => setEmphasize(false), EMPHASIS_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  // Publish the bar's height for the anchors' scroll-margin.
  const present = state !== null;
  useEffect(() => {
    const bar = barRef.current;
    if (!present || !bar) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--editor-golive-h", `${bar.getBoundingClientRect().height}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--editor-golive-h");
    };
  }, [present]);

  if (!state) return null;
  const canAct = role === "owner" || role === "admin";

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Go live"
      data-go-live-bar
      data-testid="go-live-bar"
      data-state={state.kind}
      // top = site header (sticky from `md` only) + the section-nav row above it
      // (3rem on a phone, 3.5rem from `md`).
      className={`sticky top-[calc(var(--editor-topbar-h,0px)+3rem)] z-20 -mx-4 border-b px-4 py-1 shadow-sm sm:-mx-6 sm:px-6 md:top-[calc(var(--editor-topbar-h,73px)+3.5rem)] md:py-2 ${
        ready ? "border-brand-success/40 bg-brand-success-bg" : "border-brand-border bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="hidden text-xs font-bold uppercase tracking-wide text-brand-ink-subtle sm:block">
            Not live yet
          </p>
          <p
            id={helpId}
            role="status"
            className={`text-xs font-semibold leading-snug sm:text-sm ${
              ready ? "text-brand-success" : "text-brand-ink"
            }`}
          >
            {state.kind === "ready" ? (
              state.headline
            ) : (
              <>
                {/* Phone: one short link to the checklist banner. */}
                <a
                  href="#setup-checklist"
                  className="inline-flex min-h-[44px] items-center underline decoration-brand-accent underline-offset-2 hover:text-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent sm:hidden"
                >
                  {state.count} thing{state.count === 1 ? "" : "s"} left
                </a>
                {/* From `sm`: the same sentence with a jump link per item (a 44px-tall tap
                    area from `py-3 -my-3`, so the text line keeps its height). */}
                <span className="hidden sm:inline">
                  {state.count} thing{state.count === 1 ? "" : "s"} left:{" "}
                  {state.items.map((item, index) => (
                    <span key={item.key}>
                      {index > 0 && ", "}
                      <a
                        href={`#sec-${item.sectionId}`}
                        className="-my-3 inline-block py-3 underline decoration-brand-accent underline-offset-2 hover:text-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                      >
                        {item.short}
                      </a>
                    </span>
                  ))}
                  {state.hasUnknown && (
                    <span>
                      {state.items.length > 0 && ", "}
                      finish the remaining details
                    </span>
                  )}
                </span>
              </>
            )}
          </p>
        </div>
        {canAct ? (
          <ActivateListingButton
            locationId={locationId}
            disabled={!ready}
            describedBy={helpId}
            emphasize={emphasize}
            className="shrink-0"
          />
        ) : (
          <p className="max-w-[10rem] text-right text-xs text-brand-ink-subtle">
            The owner activates the listing once this is done.
          </p>
        )}
      </div>
    </div>
  );
}
