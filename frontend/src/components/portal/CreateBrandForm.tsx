"use client";

// New restaurant brand form — POST /restaurants (docs/API_CONTRACTS.md
// "POST /restaurants"). Backs app/portal/brands/new/page.tsx, the landing
// spot for the site header's "Add Your Restaurant" CTA when a signed-in
// owner clicks it (TopBarShell.tsx) and for the dashboard's own "create a
// new brand" empty-state link (portal/dashboard/page.tsx).
//
// Only name/description/cuisine_tag_ids — the actual POST /restaurants
// body shape (frontend/src/lib/validation/restaurant.ts's
// createRestaurantSchema). Adding the brand's first location is a
// separate, not-yet-built step (flagged in this PR's description) — on
// success this redirects to /portal/dashboard, whose BrandCard already
// shows a clear "No locations yet for this brand" state rather than a
// dead end.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrandAction } from "@/app/portal/brands/new/actions";
import type { CuisineCategory, CuisineTag } from "@/types/cuisine";

const CATEGORY_LABEL: Record<CuisineCategory, string> = {
  regional: "Regional cuisine",
  dietary: "Dietary",
  type: "Restaurant type",
  signature: "Signature dishes",
  dining_time: "Dining time",
};

const CATEGORY_ORDER: CuisineCategory[] = [
  "regional",
  "type",
  "dietary",
  "signature",
  "dining_time",
];

const inputClass =
  "mt-1.5 w-full rounded-brand-control border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-ink placeholder:text-brand-placeholder focus:border-brand-accent focus:outline-none";
const labelClass = "text-sm font-semibold text-brand-ink";

function groupByCategory(tags: CuisineTag[]): Map<CuisineCategory, CuisineTag[]> {
  const groups = new Map<CuisineCategory, CuisineTag[]>();
  for (const tag of tags) {
    const list = groups.get(tag.category) ?? [];
    list.push(tag);
    groups.set(tag.category, list);
  }
  return groups;
}

export default function CreateBrandForm({ cuisineTags }: { cuisineTags: CuisineTag[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = groupByCategory(cuisineTags);

  function toggleTag(id: number) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await createBrandAction({
        name: name.trim(),
        description: description.trim(),
        cuisine_tag_ids: Array.from(selectedTagIds),
      });
      if (result.ok) {
        router.push("/portal/dashboard");
      } else {
        setError(result.error);
        setSaving(false);
      }
    } catch {
      setError("Something went wrong creating your restaurant. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <label htmlFor="brand-name" className={labelClass}>
          Restaurant name
        </label>
        <input
          id="brand-name"
          type="text"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Spice Garden"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="brand-description" className={labelClass}>
          Description
        </label>
        <textarea
          id="brand-description"
          required
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What makes your restaurant worth a visit?"
          className={inputClass}
        />
      </div>

      <div>
        <p className={labelClass}>Cuisine tags</p>
        {cuisineTags.length === 0 ? (
          <p className="mt-1.5 text-sm text-brand-ink-muted">
            Cuisine tags aren&rsquo;t available right now — you can add them later from your dashboard.
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            {CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => (
              <div key={category}>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
                  {CATEGORY_LABEL[category]}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {groups.get(category)!.map((tag) => {
                    const selected = selectedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleTag(tag.id)}
                        className={`rounded-brand-pill px-3 py-1.5 text-sm font-medium transition ${
                          selected
                            ? "bg-brand-accent text-white"
                            : "bg-brand-chip text-brand-chip-ink hover:bg-brand-border"
                        }`}
                      >
                        {tag.display_name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed">
          {error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={saving}
          className="flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-6 text-sm font-semibold text-white transition hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Creating..." : "Create restaurant"}
        </button>
      </div>
    </form>
  );
}
