"use client";

// "Cuisine & dietary tags" panel of the location editor — PUT
// /locations/{id}/cuisine-tags (docs/API_CONTRACTS.md). Tags are PER LOCATION
// (docs/DECISIONS.md "Cuisine/dietary tags are per location"): one branch can be
// vegetarian or nut-free, or skip breakfast, while another is not. They drive
// this location's search filters and the chips on its tile/page. Editable by
// the owner, an assigned manager and an admin, like every other panel here.
import { useState } from "react";
import { replaceLocationCuisineTagsAction } from "@/app/portal/locations/[id]/actions";
import CuisineTagPicker from "@/components/portal/CuisineTagPicker";
import { TagIcon } from "@/components/ui/icons";
import { sameTagIds, toggleTagId } from "@/lib/cuisine/tags";
import type { CuisineTag } from "@/types/cuisine";

export default function LocationCuisineTagsForm({
  locationId,
  allTags,
  initialTags,
}: {
  locationId: number;
  /** The whole active taxonomy (GET /cuisine-tags); empty when it failed to load. */
  allTags: CuisineTag[];
  /** This location's current tags. */
  initialTags: CuisineTag[];
}) {
  const [saved, setSaved] = useState<number[]>(() => initialTags.map((t) => t.id));
  const [selected, setSelected] = useState<number[]>(() => initialTags.map((t) => t.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = !sameTagIds(saved, selected);

  function toggle(id: number) {
    setSelected((prev) => toggleTagId(prev, id));
    setJustSaved(false);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setJustSaved(false);
    setSaving(true);
    try {
      const result = await replaceLocationCuisineTagsAction(locationId, {
        cuisine_tag_ids: selected,
      });
      if (result.ok) {
        const ids = result.data.results.map((t) => t.id);
        setSaved(ids);
        setSelected(ids);
        setJustSaved(true);
      } else {
        setError(result.error);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="tags-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="tags-heading" className="flex items-center gap-2 font-display text-xl font-bold text-brand-ink">
        <TagIcon className="h-5 w-5 text-brand-ink-subtle" />
        Cuisine &amp; dietary tags
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        These describe <span className="font-semibold text-brand-ink">this location</span> only —
        e.g. Nut Free, Andhra, Breakfast Menu. Other branches of your restaurant keep their own
        tags. Diners can filter search by them.
      </p>

      {allTags.length === 0 ? (
        <p className="mt-4 rounded-brand-control bg-brand-bg px-3 py-2.5 text-sm text-brand-ink-muted">
          Tags aren&rsquo;t available right now. Refresh the page to try again.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <CuisineTagPicker
            tags={allTags}
            selectedIds={new Set(selected)}
            onToggle={toggle}
            disabled={saving}
          />

          {error && (
            <p
              role="alert"
              className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
            >
              {error}
            </p>
          )}
          {justSaved && !error && (
            <p
              role="status"
              className="rounded-brand-control bg-brand-success-bg px-3 py-2.5 text-sm text-brand-success"
            >
              Saved.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving || !dirty}
              className="flex min-h-[44px] w-full items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Saving..." : "Save tags"}
            </button>
            <p className="text-xs text-brand-ink-subtle">
              {selected.length === 0 ? "No tags selected" : `${selected.length} selected`}
            </p>
          </div>
        </form>
      )}
    </section>
  );
}
