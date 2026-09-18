// Bounded-concurrency map — added alongside the DB connection-pool storm
// fix (backend/app/db/session.py, PR #101): shrinking the per-container
// pool wasn't enough on its own, because the real driver of the burst is
// on THIS side. portal/dashboard/page.tsx and admin/listings/page.tsx
// both fetch every brand's locations with a plain `Promise.all` across
// every restaurant — for an owner/admin viewing dozens of restaurants,
// that's dozens of concurrent Lambda execution environments spun up at
// once (module-level DB engine/pool globals are per-container, not
// shared), regardless of how small any one container's own pool is.
// `mapWithConcurrency` caps how many of these run at once, which bounds
// the burst directly instead of just shrinking what each burst member
// asks for.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      const item = items[current] as T;
      results[current] = await fn(item, current);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
