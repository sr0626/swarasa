// Page-number windowing for the city landing pages' crawlable pagination.
// Pure: unit-tested with `node --test`.

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Page numbers to render: first, last and a window around `current`, with
 * `null` standing in for a gap ("..."). */
export function buildPageList(current: number, pages: number): (number | null)[] {
  const wanted = new Set<number>([1, pages, current - 1, current, current + 1]);
  const sorted = [...wanted].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}
