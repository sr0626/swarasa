// Skeleton shown while the import page loads.
export default function AdminImportLoading() {
  return (
    <section aria-busy="true" aria-label="Loading import page">
      <div className="h-8 w-48 animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded-brand-control bg-brand-chip" />
      <div className="mt-6 h-48 animate-pulse rounded-brand-card border border-brand-border bg-brand-chip" />
    </section>
  );
}
