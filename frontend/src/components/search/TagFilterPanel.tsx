"use client";

// Fine-grained, multi-select tag filter for /search: one group of toggle
// chips per tag category (Regional cuisine, Dietary, Restaurant type, ...)
// plus a compact "active filters" chip row with remove-one / clear-all.
//
// Purely presentational — the parent (`SearchFilterBar`) owns the URL
// navigation and the dropdown container (card/popover chrome); this only
// reports toggles. Filter state lives in the URL
// (see lib/search/filters.ts) so results stay shareable and SSR.
import { useState } from "react";
import {
  countFilters,
  FILTER_PARAMS,
  isSelected,
  labelFor,
  type FilterGroup,
  type FilterParam,
  type SearchFilters,
} from "@/lib/search/filters";

/** Groups longer than this collapse behind "Show all" (selected chips are
 * always kept visible) so a 20+ tag category doesn't push results
 * off-screen on a 375px viewport. */
const COLLAPSED_CHIP_LIMIT = 8;

const CHIP_BASE =
  "min-h-[44px] rounded-brand-pill px-4 text-sm font-medium transition sm:min-h-[36px]";
const CHIP_ON = `${CHIP_BASE} bg-brand-ink text-brand-bg`;
const CHIP_OFF = `${CHIP_BASE} bg-brand-chip text-brand-chip-ink hover:bg-brand-chip/80`;

interface TagFilterPanelProps {
  groups: FilterGroup[];
  filters: SearchFilters;
  onToggle: (param: FilterParam, name: string) => void;
}

export function TagFilterPanel({ groups, filters, onToggle }: TagFilterPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const isExpanded = expanded[group.id] ?? false;
        const collapsible = group.tags.length > COLLAPSED_CHIP_LIMIT;
        const visible =
          collapsible && !isExpanded
            ? group.tags.filter(
                (tag, i) =>
                  i < COLLAPSED_CHIP_LIMIT || isSelected(filters, group.param, tag.name)
              )
            : group.tags;
        const headingId = `tag-filter-${group.id}`;

        return (
          <div key={group.id} role="group" aria-labelledby={headingId}>
            <h3
              id={headingId}
              className="mb-2 font-display text-sm font-semibold text-brand-ink"
            >
              {group.label}
            </h3>
            <div className="flex flex-wrap gap-2">
              {visible.map((tag) => {
                const on = isSelected(filters, group.param, tag.name);
                return (
                  <button
                    key={tag.name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle(group.param, tag.name)}
                    className={on ? CHIP_ON : CHIP_OFF}
                  >
                    {tag.display_name}
                  </button>
                );
              })}
              {collapsible && (
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded((prev) => ({ ...prev, [group.id]: !isExpanded }))}
                  className="min-h-[44px] rounded-brand-pill px-3 text-sm font-medium text-brand-accent underline-offset-2 hover:underline sm:min-h-[36px]"
                >
                  {isExpanded ? "Show fewer" : `Show all ${group.tags.length}`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ActiveFiltersProps {
  groups: FilterGroup[];
  filters: SearchFilters;
  onRemove: (param: FilterParam, name: string) => void;
  onClearAll: () => void;
}

/** "Active filters" summary: one compact removable chip per selected tag +
 * Clear all, in a single wrapping row. Renders nothing when no filter is
 * active. */
export function ActiveFilters({ groups, filters, onRemove, onClearAll }: ActiveFiltersProps) {
  if (countFilters(filters) === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters" role="group">
      {FILTER_PARAMS.flatMap((param) =>
        filters[param].map((name) => {
          const label = labelFor(groups, param, name);
          return (
            <button
              key={`${param}:${name}`}
              type="button"
              onClick={() => onRemove(param, name)}
              aria-label={`Remove filter ${label}`}
              className="flex min-h-[36px] items-center gap-1.5 rounded-brand-pill border border-brand-border bg-white px-3 text-xs font-medium text-brand-ink transition hover:bg-brand-chip"
            >
              {label}
              <span aria-hidden="true" className="text-base leading-none text-brand-ink-subtle">
                &times;
              </span>
            </button>
          );
        })
      )}
      <button
        type="button"
        onClick={onClearAll}
        className="min-h-[36px] px-2 text-xs font-semibold text-brand-accent underline-offset-2 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
