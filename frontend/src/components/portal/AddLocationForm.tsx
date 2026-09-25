"use client";

// "Add location" form — another branch of an EXISTING restaurant (so the owner
// doesn't create a second, unrelated brand for the same restaurant). Address +
// phone only; hours are entered next in the location editor. On success it
// lands in that editor (`/portal/locations/{id}?new=…`), where the new listing
// shows its "not live yet" setup checklist. Validation: the same zod schema
// (lib/validation/restaurant.ts `addLocationSchema`) here for instant
// field-level errors and again in the server action (the real gate).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addLocationAction } from "@/app/portal/locations/new/actions";
import CuisineTagPicker from "@/components/portal/CuisineTagPicker";
import {
  EMPTY_LOCATION_VALUES,
  LocationFields,
  type LocationFieldValues,
} from "@/components/portal/formFields";
import { toggleTagId } from "@/lib/cuisine/tags";
import { fieldErrorsFromZod, type FieldErrors } from "@/lib/validation/fieldErrors";
import { addLocationSchema } from "@/lib/validation/restaurant";
import type { CuisineTag } from "@/types/cuisine";

export default function AddLocationForm({
  brandId,
  brandName,
  cancelHref,
  cuisineTags = [],
  initialTagIds = [],
}: {
  brandId: number;
  brandName: string;
  /** Where "Cancel" goes back to (the caller's home for brands). */
  cancelHref: string;
  /** The active tag taxonomy for the picker; empty hides the picker (the backend then copies the first location's tags). */
  cuisineTags?: CuisineTag[];
  /** Pre-selected tag ids: the tags of the brand's first location. */
  initialTagIds?: number[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<LocationFieldValues>(EMPTY_LOCATION_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [tagIds, setTagIds] = useState<number[]>(initialTagIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only send tags when the picker was shown; otherwise the backend copies them itself.
  const showTags = cuisineTags.length > 0;

  function set<K extends keyof LocationFieldValues>(key: K, value: LocationFieldValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function focusFirstError(errors: FieldErrors) {
    const first = Object.keys(errors).find((key) => key !== "_form");
    if (first) requestAnimationFrame(() => document.getElementById(first)?.focus());
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const input = showTags ? { ...values, cuisine_tag_ids: tagIds } : values;
    const parsed = addLocationSchema.safeParse(input);
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
      setError("Please fix the highlighted fields and try again.");
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const result = await addLocationAction(brandId, input);
      if (result.ok) {
        router.push(`/portal/locations/${result.locationId}?new=${result.mapPosition}`);
        return;
      }
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
        focusFirstError(result.fieldErrors);
      }
      setError(result.error);
    } catch {
      setError("Something went wrong adding this location. Please try again.");
    }
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <p className="text-sm text-brand-ink-muted">
        Where is this new branch of <span className="font-semibold text-brand-ink">{brandName}</span>
        ? We use the address to place it on the map. It starts hidden until you add its hours and
        activate it.
      </p>

      <LocationFields values={values} errors={fieldErrors} onChange={set} />

      {showTags && (
        <div>
          <p className="text-sm font-semibold text-brand-ink">Cuisine &amp; dietary tags</p>
          <p className="mt-1 text-xs text-brand-ink-subtle">
            For this branch only — we started you with the tags of your first location.
          </p>
          <div className="mt-2">
            <CuisineTagPicker
              tags={cuisineTags}
              selectedIds={new Set(tagIds)}
              onToggle={(id) => setTagIds((prev) => toggleTagId(prev, id))}
              disabled={saving}
            />
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Adding..." : "Add location"}
        </button>
        <a
          href={cancelHref}
          className="flex min-h-[44px] items-center px-2 text-sm font-semibold text-brand-ink-muted underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        >
          Cancel
        </a>
      </div>
      {saving && (
        <p role="status" className="text-xs text-brand-ink-subtle">
          Setting up the location and finding it on the map — this can take a few seconds.
        </p>
      )}
    </form>
  );
}
