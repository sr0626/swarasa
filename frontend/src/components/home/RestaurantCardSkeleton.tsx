// Loading skeleton for a single "Popular near you" card — shown only while
// the real request is in flight (frontend/CLAUDE.md "ALWAYS show a loading
// skeleton, not a blank screen, while data loads"). Purely decorative
// placeholder blocks, never real or fabricated restaurant content.
export default function RestaurantCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card"
    >
      <div className="h-40 w-full animate-pulse bg-brand-chip" />
      {/* Same fixed body height as RestaurantCard (224px): no layout jump
          when the real tiles replace the skeletons. */}
      <div className="flex h-56 flex-col gap-3 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-brand-chip" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-brand-chip" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-brand-chip" />
      </div>
    </div>
  );
}
