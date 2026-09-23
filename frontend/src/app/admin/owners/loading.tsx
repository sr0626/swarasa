// Skeleton shown while the (server-rendered) owners report loads.
export default function AdminOwnersLoading() {
  return (
    <section aria-busy="true" aria-label="Loading owners">
      <div className="h-8 w-40 animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-6 h-10 w-full max-w-md animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-6 space-y-2 rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-10 animate-pulse rounded-brand-control bg-brand-chip" />
        ))}
      </div>
    </section>
  );
}
