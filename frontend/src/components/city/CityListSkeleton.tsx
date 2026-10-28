/** Suspense fallback for <CityList>. */
export default function CityListSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[52px] animate-pulse rounded-brand-card border border-brand-border bg-white" />
      ))}
    </div>
  );
}
