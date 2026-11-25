// Empty-state copy for the public search results. Pure (no React / Next), so
// it runs under `node --test`.

export function emptyResultsBody(input: {
  filterCount: number;
  openNow: boolean;
  query: string;
}): string {
  if (input.filterCount > 0) {
    return input.openNow
      ? "No matching restaurants are open right now (restaurants with unknown hours are left out). Try removing a filter, or use Clear all to see everything nearby."
      : "No restaurants have all of these tags yet. Try removing a filter, or use Clear all to see everything nearby.";
  }
  if (input.query.trim()) {
    return "We couldn't find a restaurant matching that. Check the name and city and try again.";
  }
  return "No restaurants are listed here yet. Check back soon.";
}
