// Loading skeleton for a single "Popular near you" card — shown only while
// the real request is in flight (frontend/CLAUDE.md "ALWAYS show a loading
// skeleton, not a blank screen, while data loads"). Purely decorative
// placeholder blocks, never real or fabricated restaurant content.
//
// Mirrors RestaurantCard's tight top-stacked body (name, cuisines, address,
// hours pill, all from the top) and shares its `min-h-[18.8rem]`, so the real
// tiles replace the skeletons with no layout jump.
export default function RestaurantCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[18.8rem] flex-col overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card"
    >
      <div className="h-40 w-full shrink-0 animate-pulse bg-brand-chip" />
      <div className="flex flex-col gap-2 px-4 pt-4">
        <div className="h-6 w-2/3 animate-pulse rounded bg-brand-chip" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-brand-chip" />
        <div className="h-5 w-3/4 animate-pulse rounded bg-brand-chip" />
        <div className="h-7 w-32 animate-pulse rounded-brand-pill bg-brand-chip" />
      </div>
    </div>
  );
}
