// Pure geometry for the horizontally scrolling pill rows on phones (the console
// menu, ConsoleSidebarNav.tsx). Kept out of the components so the numbers are
// unit-testable (horizontalScroll.test.ts).

/**
 * `scrollLeft` that centers an item inside its scroller, clamped to the
 * scrollable range (so a first/last item lands flush with the edge instead of
 * asking for an impossible offset).
 */
export function centerScrollLeft(
  itemLeft: number,
  itemWidth: number,
  containerWidth: number,
  scrollWidth: number
): number {
  const max = Math.max(0, scrollWidth - containerWidth);
  const target = itemLeft - (containerWidth - itemWidth) / 2;
  return Math.min(max, Math.max(0, Math.round(target)));
}

export interface ScrollEdges {
  /** Content is hidden past the left edge. */
  left: boolean;
  /** Content is hidden past the right edge. */
  right: boolean;
}

/** Which edges of a scroller still have content beyond them (1px tolerance for sub-pixel rounding). */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): ScrollEdges {
  return {
    left: scrollLeft > 1,
    right: scrollLeft + clientWidth < scrollWidth - 1,
  };
}
