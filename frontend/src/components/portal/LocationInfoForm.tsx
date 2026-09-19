"use client";

// Location info/address edit form — PATCH /locations/{id}
// (docs/API_CONTRACTS.md "PATCH /locations/{id}").
//
// JUDGMENT CALL (see this PR's description): the task brief for this
// section said "name, description, whatever fields PATCH /locations/{id}
// actually accepts per the contract." Per the actual contract, `PATCH
// /locations/{id}` only accepts the address/contact/timezone/geo fields
// below — `name` and `description` belong to the parent brand
// (`PATCH /restaurants/{id}`, already implemented in
// frontend/src/lib/api/restaurants.ts), not the location. Editing the
// brand's name/description from a single-location page would conflate two
// different resources (a brand can have multiple locations), so this form
// only edits what `PATCH /locations/{id}` actually documents.
import { useState } from "react";
import { updateLocationInfoAction } from "@/app/portal/locations/[id]/actions";
import { PencilIcon } from "@/components/ui/icons";
import type { LocationDetail } from "@/types/location";

interface FormState {
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
  timezone: string;
  latitude: string;
  longitude: string;
}

function toFormState(location: LocationDetail): FormState {
  return {
    address_line1: location.address_line1,
    address_line2: location.address_line2 ?? "",
    city: location.city,
    state: location.state,
    postal_code: location.postal_code,
    country: location.country,
    phone: location.phone ?? "",
    timezone: location.timezone,
    // Null until the address has been geocoded (see NewListingNotice).
    latitude: location.latitude === null ? "" : String(location.latitude),
    longitude: location.longitude === null ? "" : String(location.longitude),
  };
}

/** True when the street/city/state/ZIP differ — coordinates would go stale. */
function addressChanged(a: FormState, b: FormState): boolean {
  return (
    a.address_line1.trim() !== b.address_line1.trim() ||
    a.city.trim() !== b.city.trim() ||
    a.state.trim().toUpperCase() !== b.state.trim().toUpperCase() ||
    a.postal_code.trim() !== b.postal_code.trim()
  );
}

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

export default function LocationInfoForm({ location }: { location: LocationDetail }) {
  const [form, setForm] = useState<FormState>(toFormState(location));
  // Last-saved values: what "did the owner change the address / type new
  // coordinates" is measured against.
  const [baseline, setBaseline] = useState<FormState>(toFormState(location));
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaved(false);

    const latText = form.latitude.trim();
    const lngText = form.longitude.trim();
    if ((latText === "") !== (lngText === "")) {
      setError("Enter both latitude and longitude, or leave both blank.");
      return;
    }
    const latitude = latText === "" ? null : Number(latText);
    const longitude = lngText === "" ? null : Number(lngText);
    if (
      (latitude !== null && !Number.isFinite(latitude)) ||
      (longitude !== null && !Number.isFinite(longitude))
    ) {
      setError("Latitude and longitude must be numbers.");
      return;
    }

    // Address edited without hand-typing new coordinates: re-geocode
    // server-side rather than leaving the old (now wrong) position. Also
    // covers a listing that has no position yet (blank coordinates).
    const coordsEditedByHand =
      form.latitude.trim() !== baseline.latitude.trim() ||
      form.longitude.trim() !== baseline.longitude.trim();
    const regeocode =
      !coordsEditedByHand && (addressChanged(form, baseline) || latitude === null);

    setSaving(true);
    try {
      const result = await updateLocationInfoAction(
        location.id,
        {
          address_line1: form.address_line1.trim(),
          address_line2: form.address_line2.trim() || null,
          city: form.city.trim(),
          state: form.state.trim().toUpperCase(),
          postal_code: form.postal_code.trim(),
          country: form.country.trim().toUpperCase(),
          phone: form.phone.trim(),
          timezone: form.timezone.trim(),
          // When re-geocoding, the server supplies fresh coordinates.
          ...(regeocode || latitude === null || longitude === null ? {} : { latitude, longitude }),
        },
        { regeocode }
      );
      if (result.ok) {
        const next = toFormState(result.data);
        setForm(next);
        setBaseline(next);
        setSaved(true);
        setNotice(result.notice ?? null);
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="info-heading" className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
      <h2 id="info-heading" className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink">
        <PencilIcon className="h-5 w-5 text-brand-ink-subtle" />
        Location details
      </h2>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="address_line1" className={labelClass}>Address line 1</label>
          <input
            id="address_line1"
            type="text"
            required
            value={form.address_line1}
            onChange={(e) => set("address_line1", e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="address_line2" className={labelClass}>Address line 2</label>
          <input
            id="address_line2"
            type="text"
            value={form.address_line2}
            onChange={(e) => set("address_line2", e.target.value)}
            placeholder="Suite, unit, etc. (optional)"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="city" className={labelClass}>City</label>
          <input
            id="city"
            type="text"
            required
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="state" className={labelClass}>State</label>
          <input
            id="state"
            type="text"
            required
            maxLength={2}
            value={form.state}
            onChange={(e) => set("state", e.target.value)}
            placeholder="TX"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="postal_code" className={labelClass}>ZIP code</label>
          <input
            id="postal_code"
            type="text"
            required
            value={form.postal_code}
            onChange={(e) => set("postal_code", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="country" className={labelClass}>Country</label>
          <input
            id="country"
            type="text"
            required
            maxLength={2}
            value={form.country}
            onChange={(e) => set("country", e.target.value)}
            placeholder="US"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone <span className="font-normal text-brand-ink-subtle">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="timezone" className={labelClass}>Timezone</label>
          <input
            id="timezone"
            type="text"
            required
            value={form.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            placeholder="America/Chicago"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="latitude" className={labelClass}>Latitude</label>
          <input
            id="latitude"
            type="number"
            step="any"
            value={form.latitude}
            onChange={(e) => set("latitude", e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="longitude" className={labelClass}>Longitude</label>
          <input
            id="longitude"
            type="number"
            step="any"
            value={form.longitude}
            onChange={(e) => set("longitude", e.target.value)}
            className={inputClass}
          />
        </div>

        {error && (
          <p className="sm:col-span-2 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
            {error}
          </p>
        )}
        {saved && !error && !notice && (
          <p className="sm:col-span-2 rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success">
            Saved.
          </p>
        )}
        {saved && !error && notice && (
          <p className="sm:col-span-2 rounded-brand-control bg-brand-chip px-3 py-2.5 text-sm text-brand-ink">
            {notice}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Saving..." : "Save details"}
          </button>
        </div>
      </form>
    </section>
  );
}
