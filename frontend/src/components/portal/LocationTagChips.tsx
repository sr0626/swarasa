// Compact, wrapping row of one location's cuisine / dietary tag chips for the owner's
// brand card: the first `max` tags, then a "+N" chip for the rest (its title/aria-label
// lists them). Tags are PER LOCATION (docs/DECISIONS.md "Cuisine/dietary tags are per
// location"), so every location row shows its own. Server-safe (no state).
import { summarizeTags } from "@/lib/cuisine/tags";
import type { CuisineTag } from "@/types/cuisine";

const chipClass =
  "rounded-brand-pill bg-brand-chip px-2 py-0.5 text-xs font-medium text-brand-chip-ink";

export default function LocationTagChips({
  tags,
  max = 4,
}: {
  tags: readonly CuisineTag[];
  max?: number;
}) {
  if (tags.length === 0) {
    return <span className="text-xs text-brand-ink-subtle">No cuisine tags yet</span>;
  }
  const { shown, hiddenCount } = summarizeTags(tags, max);
  const hidden = tags.slice(shown.length).map((tag) => tag.display_name);
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Cuisine and dietary tags">
      {shown.map((tag) => (
        <li key={tag.id} className={chipClass}>
          {tag.display_name}
        </li>
      ))}
      {hiddenCount > 0 && (
        <li
          className={chipClass}
          title={hidden.join(", ")}
          aria-label={`${hiddenCount} more: ${hidden.join(", ")}`}
        >
          +{hiddenCount}
        </li>
      )}
    </ul>
  );
}
