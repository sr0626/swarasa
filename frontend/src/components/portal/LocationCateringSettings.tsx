"use client";

// Location editor "Catering" section: the per-location opt-in switch
// ("Accept catering requests", PUT /locations/{id}/catering-settings). Being
// opted in is only half of the rule — diners can choose a location only while
// it is ALSO subscribed — so the panel says which half is missing. Owner,
// assigned manager and admin all see it; the API re-checks access.
import Link from "next/link";
import { useState } from "react";
import LocalDateTime from "@/components/ui/LocalDateTime";
import { setCateringOptInAction } from "@/lib/actions/catering";
import { CATERING_INBOX_HREF } from "@/components/console/navItems";
import type { CateringSettings } from "@/types/catering";

export default function LocationCateringSettings({
  locationId,
  initial,
  role,
}: {
  locationId: number;
  /** null when the settings couldn't be loaded. */
  initial: CateringSettings | null;
  role: string;
}) {
  const [settings, setSettings] = useState<CateringSettings | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!settings || busy) return;
    const next = !settings.accepts_catering;
    setBusy(true);
    setError(null);
    const result = await setCateringOptInAction(locationId, next);
    setBusy(false);
    if (result.ok) setSettings(result.data);
    else setError(result.error);
  }

  return (
    <section
      aria-labelledby="catering-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="catering-heading" className="font-display text-xl font-bold text-brand-ink">
        Catering requests
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Let signed-in diners request catering quotes from this location.{" "}
        {role === "admin" ? (
          "The owner and assigned managers answer from their Catering requests inbox."
        ) : (
          <>
            You answer from your{" "}
            <Link href={CATERING_INBOX_HREF} className="font-semibold underline">
              Catering requests inbox
            </Link>
            .
          </>
        )}
      </p>

      {!settings ? (
        <p className="mt-4 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-ink-muted">
          We couldn&apos;t load this setting right now. Refresh the page to try again.
        </p>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-4 rounded-brand-control border border-brand-border bg-brand-bg p-4">
            <p id="catering-switch-label" className="min-w-0 text-sm font-semibold text-brand-ink">
              Accept catering requests
              <span className="block text-xs font-normal text-brand-ink-subtle">
                {settings.accepts_catering ? "On" : "Off"}
              </span>
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={settings.accepts_catering}
              aria-labelledby="catering-switch-label"
              disabled={busy}
              onClick={toggle}
              className={
                "relative inline-flex h-11 w-[4.5rem] shrink-0 items-center rounded-brand-pill border transition disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent " +
                (settings.accepts_catering ? "border-brand-ink bg-brand-ink" : "border-brand-border bg-white")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "inline-block h-8 w-8 transform rounded-full transition " +
                  (settings.accepts_catering ? "translate-x-9 bg-brand-bg" : "translate-x-1 bg-brand-ink-subtle")
                }
              />
            </button>
          </div>

          <p role="status" aria-live="polite" className="mt-3 text-sm text-brand-ink-muted">
            {settings.subscribed ? (
              settings.accepts_catering ? (
                "Diners can choose this location when they request catering quotes."
              ) : (
                "This location is subscribed, but it won't appear to diners until you turn this on."
              )
            ) : (
              <>
                Catering requests are only sent to <span className="font-semibold">subscribed</span>{" "}
                locations, and this one isn&apos;t subscribed yet
                {settings.accepts_catering ? " — your opt-in is saved and takes effect as soon as it is" : ""}.
                For now an administrator switches subscriptions on; contact the admins to enable it.
              </>
            )}
            {settings.subscribed && settings.paid_until && (
              <>
                {" "}
                Subscribed until <LocalDateTime value={settings.paid_until} variant="date" />.
              </>
            )}
          </p>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {error}
        </p>
      )}
    </section>
  );
}
