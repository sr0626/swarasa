// Which section the location editor's jump-link row should highlight -- pure so
// it is unit-testable (activeSection.test.ts). Used by EditorSectionNav.
//
// Rule: the LAST section (in page order) whose top has scrolled up to or past
// the "reading line" just under the sticky stack. That is the section the
// reader is inside -- unlike "first section currently visible", which stays on
// an earlier, still-peeking section while a later one fills the screen.
// Two edge cases:
//   - nothing has reached the line yet (top of the page): highlight the first
//     section that already sits in the upper part of the viewport, else none;
//   - scrolled to the very bottom: the last section wins, because a short final
//     section (Managers) can never scroll its top up to the line.

export interface SectionPosition {
  /** Anchor id of the section. */
  id: string;
  /** `getBoundingClientRect().top` of the section element. */
  top: number;
}

export interface PickInput {
  /** Sections in page order. */
  positions: readonly SectionPosition[];
  /** Viewport-relative y of the reading line (sticky stack height + a little air). */
  line: number;
  /** Viewport height, used only for the "already in the upper part" fallback. */
  viewportHeight: number;
  /** True when the page is scrolled to its bottom (and is actually scrollable). */
  atPageBottom: boolean;
}

export function pickActiveSectionId({
  positions,
  line,
  viewportHeight,
  atPageBottom,
}: PickInput): string | null {
  if (positions.length === 0) return null;
  if (atPageBottom) return positions[positions.length - 1]!.id;

  let active: string | null = null;
  for (const p of positions) {
    if (p.top <= line) active = p.id;
  }
  if (active) return active;

  const upperBand = viewportHeight * 0.45;
  const first = positions.find((p) => p.top < upperBand);
  return first ? first.id : null;
}

/** True when the document is scrolled to (within 2px of) its bottom and is longer than the viewport. */
export function isAtPageBottom(scrollY: number, viewportHeight: number, scrollHeight: number): boolean {
  return scrollHeight > viewportHeight + 8 && viewportHeight + scrollY >= scrollHeight - 2;
}
