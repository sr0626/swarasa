"use client";

// The "Activate listing" button, shared by the sticky Go-live bar and the
// inline "Hours saved. Everything's ready" prompts (LocationHoursEditor /
// LocationInfoForm). It performs the existing status server action
// (`updateLocationStatusAction(id, "active")` -> POST /locations/{id}/status),
// which is the authority: it re-checks readiness and answers 422
// `listing_incomplete` if anything is still missing, and that message is shown
// as-is under the button.
//
// On success it replaces the URL with `?live=1` so the server re-renders the
// editor as a live listing and shows the "Your listing is live" notice
// (ListingLiveNotice) with a link to the public page; the Go-live bar (which
// only renders while the listing is in setup) disappears with that render.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { updateLocationStatusAction } from "@/app/portal/locations/[id]/actions";

export default function ActivateListingButton({
  locationId,
  disabled = false,
  describedBy,
  size = "lg",
  emphasize = false,
  className = "",
}: {
  locationId: number;
  /** True while the checklist isn't complete (the server would refuse anyway). */
  disabled?: boolean;
  /** Id of the element that explains why it's disabled (aria-describedby). */
  describedBy?: string;
  size?: "lg" | "md";
  /** A few soft glow pulses (finite; respects reduced motion). */
  emphasize?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refusal message is stale once the checklist changes under it.
  useEffect(() => {
    if (!disabled) return;
    setError(null);
  }, [disabled]);

  async function activate() {
    setError(null);
    setActivating(true);
    try {
      const result = await updateLocationStatusAction(locationId, "active");
      if (result.ok) {
        // Leave `activating` on: the page is about to re-render as live.
        router.replace(`/portal/locations/${locationId}?live=1`);
        return;
      }
      setError(result.error);
      // Re-read the checklist: the refusal may mean it changed under us.
      router.refresh();
    } catch {
      setError("Something went wrong activating this listing. Please try again.");
    }
    setActivating(false);
  }

  const sizing =
    size === "lg"
      ? "min-h-[44px] px-4 text-sm sm:min-h-[48px] sm:px-7 sm:text-base"
      : "min-h-[44px] px-5 text-sm";
  const pulse = emphasize && !disabled && !activating ? " motion-safe:animate-go-live-glow" : "";

  return (
    <div className={`flex flex-col items-stretch ${className}`}>
      <button
        type="button"
        onClick={activate}
        disabled={disabled || activating}
        aria-describedby={describedBy}
        data-testid="activate-listing"
        className={`flex items-center justify-center whitespace-nowrap rounded-brand-control bg-brand-accent font-semibold text-white shadow-brand-control transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-brand-ink-subtle disabled:opacity-70 ${sizing}${pulse}`}
      >
        {activating ? "Activating..." : "Activate listing"}
      </button>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-brand-control bg-brand-closed-bg px-3 py-2 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}
    </div>
  );
}
