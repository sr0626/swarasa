// Empty-state copy for the catering "Choose restaurants" picker. Pure: the
// component renders whatever this returns. Called only when the search
// returned ZERO eligible restaurants. The API never says WHY a restaurant is
// not accepting requests, so neither does any message here. No React / Next
// imports so it runs under `node --test`; type imports are erased.
import type { UnavailableMatch } from "@/types/catering";

export type SearchEmptyMessage =
  | { kind: "single"; headline: string; hint: string }
  | { kind: "several"; headline: string; matches: UnavailableMatch[]; hint: string }
  | { kind: "not_found"; headline: string }
  | { kind: "none_yet"; headline: string };

const TRY_ANOTHER = "Try another restaurant.";

export function emptySearchMessage(input: {
  q: string;
  city: string;
  unavailable: readonly UnavailableMatch[] | null | undefined;
}): SearchEmptyMessage {
  const unavailable = input.unavailable ?? [];
  const [only] = unavailable;
  if (only && unavailable.length === 1) {
    return {
      kind: "single",
      headline: `${only.name} (${only.city}) isn't accepting catering requests.`,
      hint: TRY_ANOTHER,
    };
  }
  if (unavailable.length > 1) {
    return {
      kind: "several",
      headline: "These restaurants match your search but aren't accepting catering requests:",
      matches: [...unavailable],
      hint: TRY_ANOTHER,
    };
  }
  if (input.q.trim() || input.city.trim()) {
    return {
      kind: "not_found",
      headline:
        "We couldn't find a restaurant matching that. Check the name and city and try again.",
    };
  }
  return {
    kind: "none_yet",
    headline: "No restaurants are accepting catering requests yet. Please check back soon.",
  };
}
