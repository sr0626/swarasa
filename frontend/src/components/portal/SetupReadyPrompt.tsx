"use client";

// Inline "Hours saved. Everything's ready — [Activate listing]" prompt shown
// right next to a form's Save button (LocationHoursEditor, LocationInfoForm)
// when that save completed the listing's setup checklist. Renders nothing
// unless the save just happened (`saved`), the listing is in setup, nothing is
// left on the checklist, and the viewer may activate (owner/admin). The
// checklist is the server's (`setup_missing`, refreshed after the save), and
// the activation itself is still re-checked server-side.
import ActivateListingButton from "@/components/portal/ActivateListingButton";
import { canActivate } from "@/lib/portal/listingSetup";
import type { LocationStatus } from "@/types/location";

export default function SetupReadyPrompt({
  locationId,
  status,
  setupMissing,
  role,
  saved,
  savedLabel,
}: {
  locationId: number;
  status: LocationStatus;
  setupMissing: string[];
  role: string;
  /** True right after a successful save. */
  saved: boolean;
  /** "Hours saved." / "Details saved." */
  savedLabel: string;
}) {
  const canAct = role === "owner" || role === "admin";
  if (!saved || !canAct || !canActivate(status, setupMissing)) return null;
  return (
    <div
      role="status"
      data-testid="setup-ready-prompt"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-brand-control bg-brand-success-bg px-3 py-2"
    >
      <p className="text-sm font-semibold text-brand-success">
        {savedLabel} Everything&rsquo;s ready &mdash;
      </p>
      <ActivateListingButton locationId={locationId} size="md" emphasize />
    </div>
  );
}
