// Skeleton shown while the (server-rendered) managers report loads.
export default function AdminManagersLoading() {
  return (
    <section aria-busy="true" aria-label="Loading managers">
      <div className="h-8 w-40 animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-6 h-11 w-full max-w-md animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-brand-card border border-brand-border bg-brand-chip"
          />
        ))}
      </div>
    </section>
  );
}
