"use client";

// A diner's home city + ZIP (mandatory for registered users since
// 2026-10-07). Always editable -- unlike the display name there is no
// set-once lock. When nothing is saved yet (`required`), the card renders as
// a prominent top-of-page prompt: it is the form itself, so there is no way
// to dismiss it without saving, and saving needs BOTH fields. Browsing is
// never blocked; the prompt just stays until the location exists.
// PATCH /auth/me via `updateLocationAction`; the backend re-validates.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateLocationAction } from "@/app/account/actions";
import { LocationPinIcon } from "@/components/ui/icons";
import { LOCATION_HELPER_TEXT, userLocationSchema } from "@/lib/validation/userLocation";

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

export default function LocationForm({
  initialCity,
  initialPostalCode,
  required,
}: {
  initialCity: string | null;
  initialPostalCode: string | null;
  /** True while the diner has no saved location -- renders the prominent prompt. */
  required: boolean;
}) {
  const router = useRouter();
  const [city, setCity] = useState(initialCity ?? "");
  const [postalCode, setPostalCode] = useState(initialPostalCode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const parsed = userLocationSchema.safeParse({ city, postal_code: postalCode });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check your city and ZIP.");
      return;
    }

    setSaving(true);
    try {
      const result = await updateLocationAction(parsed.data);
      if (result.ok) {
        setCity(result.data.city ?? parsed.data.city);
        setPostalCode(result.data.postal_code ?? parsed.data.postal_code);
        setSaved(true);
        // Re-render the server page so the prompt/banner goes away.
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="location"
      aria-labelledby="location-heading"
      className={
        required
          ? "rounded-brand-card border-2 border-brand-accent bg-white p-5 shadow-brand-card sm:p-6"
          : "rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
      }
    >
      <h2
        id="location-heading"
        className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink"
      >
        <LocationPinIcon className="h-5 w-5 text-brand-ink-subtle" />
        {required ? "Add your city and ZIP" : "Your location"}
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        {LOCATION_HELPER_TEXT}
        {required && " Both are required to finish setting up your account."}
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="location_city" className={labelClass}>
              City
            </label>
            <input
              id="location_city"
              type="text"
              required
              autoComplete="address-level2"
              maxLength={100}
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setSaved(false);
              }}
              className={inputClass}
              placeholder="Plano"
            />
          </div>
          <div className="sm:w-40">
            <label htmlFor="location_postal_code" className={labelClass}>
              ZIP code
            </label>
            <input
              id="location_postal_code"
              type="text"
              required
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={10}
              value={postalCode}
              onChange={(e) => {
                setPostalCode(e.target.value);
                setSaved(false);
              }}
              className={inputClass}
              placeholder="75093"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || city.trim().length === 0 || postalCode.trim().length === 0}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start"
        >
          {saving ? "Saving..." : "Save location"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-3 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
          Saved.
        </p>
      )}
    </section>
  );
}
