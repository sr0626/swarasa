// Skeleton shown while the (server-rendered) audit log loads.
export default function AdminAuditLogLoading() {
  return (
    <section aria-busy="true" aria-label="Loading audit log">
      <div className="h-8 w-40 animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-6 h-24 w-full animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-20 animate-pulse rounded-brand-card border border-brand-border bg-brand-chip"
          />
        ))}
      </div>
    </section>
  );
}
