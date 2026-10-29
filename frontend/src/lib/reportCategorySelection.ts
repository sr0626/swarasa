// Pure logic for the multi-select "What's wrong?" checkbox group on the public
// report form (ReportProblemForm.tsx). Kept out of the component so it can be
// unit tested (`npm run test:unit`, node --test; relative imports only).
//
// Selection is always held in the canonical option order (the order the
// options are listed), regardless of the order boxes were ticked, so the
// first entry is the "primary" category the backend stores in `category`.
import type { ReportCategory } from "../types/listingReport.ts";

export const REPORT_CATEGORY_REQUIRED_MESSAGE =
  "Please select at least one thing that's wrong.";

// Mirrors the order of REPORT_CATEGORIES (lib/constants/reportCategories.ts)
// and the backend's REPORT_CATEGORY_ORDER. Declared here rather than imported
// because a runtime import of a sibling .ts file breaks either `tsc` or
// `node --test`; reportCategorySelection.test.ts asserts the two stay equal.
export const CANONICAL_ORDER: readonly ReportCategory[] = [
  "address_incorrect",
  "hours_incorrect",
  "phone_incorrect",
  "price_incorrect",
  "menu_incorrect",
  "deal_incorrect",
  "permanently_closed",
  "other",
];

/** Unique values from `selected`, in canonical option order; unknown values dropped. */
export function orderCategories(selected: readonly ReportCategory[]): ReportCategory[] {
  const wanted = new Set(selected);
  return CANONICAL_ORDER.filter((value) => wanted.has(value));
}

/** Tick/untick `value`; the result is canonical-ordered and never mutates `selected`. */
export function toggleCategory(
  selected: readonly ReportCategory[],
  value: ReportCategory
): ReportCategory[] {
  return selected.includes(value)
    ? orderCategories(selected.filter((v) => v !== value))
    : orderCategories([...selected, value]);
}

/**
 * Error text when the selection is not submittable (none ticked), else null.
 * The existing "details required" rule is unchanged and lives in
 * `createReportSchema` — selecting "Other" adds no extra requirement because
 * the "Tell us more" text is already required for every category.
 */
export function validateCategorySelection(
  selected: readonly ReportCategory[]
): string | null {
  return orderCategories(selected).length === 0 ? REPORT_CATEGORY_REQUIRED_MESSAGE : null;
}
