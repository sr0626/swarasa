// Restaurant selection for the "Choose restaurants" step: a capped set of
// location ids. Pure, order-preserving, never mutates its input. The cap
// comes from the API (`GET /catering/config` -> `max_restaurants`); the
// server enforces it again on submit.

export interface ToggleResult {
  selected: number[];
  /** True when an add was refused because the cap is already reached. */
  atCap: boolean;
}

export function toggleSelection(selected: readonly number[], id: number, max: number): ToggleResult {
  if (selected.includes(id)) {
    return { selected: selected.filter((s) => s !== id), atCap: false };
  }
  if (selected.length >= max) {
    return { selected: [...selected], atCap: true };
  }
  return { selected: [...selected, id], atCap: false };
}

/** "3 of 5 selected". */
export function selectionCounter(count: number, max: number): string {
  return `${count} of ${max} selected`;
}

/** An unselected row is disabled once the cap is reached (a selected one stays tappable). */
export function isRowDisabled(selected: readonly number[], id: number, max: number): boolean {
  return !selected.includes(id) && selected.length >= max;
}

/** If the cap shrank between visits, keep the first `max` picks. */
export function clampSelection(selected: readonly number[], max: number): number[] {
  return selected.slice(0, Math.max(0, max));
}

export function canContinue(selected: readonly number[], max: number): boolean {
  return selected.length >= 1 && selected.length <= max;
}
