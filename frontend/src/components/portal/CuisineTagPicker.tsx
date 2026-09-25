"use client";

// Toggle-chip picker for cuisine / dietary / type / signature / dining-time
// tags, grouped by category. Tags are PER LOCATION (docs/DECISIONS.md
// "Cuisine/dietary tags are per location"), so this one control is shared by the
// "Add your restaurant" form, the "Add location" form and the location editor's
// "Cuisine & dietary tags" panel. Controlled: the parent owns the selection.
//
// Mobile-first: chips wrap, every chip is a 44px touch target, no horizontal
// scroll at 375px.
import {
  CUISINE_CATEGORY_LABEL,
  groupTagsByCategory,
  orderedCategories,
} from "@/lib/cuisine/tags";
import type { CuisineTag } from "@/types/cuisine";

export default function CuisineTagPicker({
  tags,
  selectedIds,
  onToggle,
  disabled = false,
}: {
  tags: readonly CuisineTag[];
  selectedIds: ReadonlySet<number>;
  onToggle: (id: number) => void;
  /** Locks the chips (they stay visible, unselected ones dimmed). */
  disabled?: boolean;
}) {
  const groups = groupTagsByCategory(tags);
  return (
    <div className="flex flex-col gap-4">
      {orderedCategories(groups).map((category) => (
        <div key={category}>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
            {CUISINE_CATEGORY_LABEL[category]}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {groups.get(category)!.map((tag) => {
              const selected = selectedIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onToggle(tag.id)}
                  className={`min-h-[44px] rounded-brand-pill px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed ${
                    selected
                      ? "bg-brand-accent text-white"
                      : "bg-brand-chip text-brand-chip-ink hover:bg-brand-border"
                  } ${disabled && !selected ? "opacity-50" : ""}`}
                >
                  {tag.display_name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
