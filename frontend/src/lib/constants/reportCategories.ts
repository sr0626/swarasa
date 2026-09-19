// Friendly labels for the `listing_report.category` values
// (docs/API_CONTRACTS.md "Listing reports"). The form shows these in this
// order; the admin triage panel reuses them so both sides read the same.
import type { ReportCategory } from "@/types/listingReport";

export const REPORT_CATEGORIES: ReadonlyArray<{
  value: ReportCategory;
  label: string;
}> = [
  { value: "address_incorrect", label: "Address is wrong or not found" },
  { value: "hours_incorrect", label: "Hours are wrong" },
  { value: "phone_incorrect", label: "Phone number is wrong" },
  { value: "price_incorrect", label: "Price is not correct" },
  { value: "menu_incorrect", label: "Menu is wrong" },
  { value: "permanently_closed", label: "Permanently closed" },
  { value: "other", label: "Other" },
];

export function reportCategoryLabel(category: ReportCategory): string {
  return REPORT_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}
