// Shared Tailwind class for every jump-link target in the location editor:
// leaves room for the sticky site header (its sticky height is published as
// `--editor-topbar-h` by EditorSectionNav: 0 below `md`, where the editor's
// header scrolls away, else the measured height; fallbacks 0px / 73px before
// hydration) plus the sticky section-link row (3rem on a phone, 3.5rem from
// `md`) plus the sticky Go-live bar when the listing is in setup (its height is
// published as `--editor-golive-h`, 0 otherwise) plus 1rem of air, so a target is
// never hidden underneath them. Lives in a plain .ts under components/ (not
// lib/) so Tailwind's content globs see the class, and is not a "use client"
// module so server components can import the string.
export const SECTION_ANCHOR_CLASS =
  "scroll-mt-[calc(var(--editor-topbar-h,0px)+var(--editor-golive-h,0px)+4rem)] md:scroll-mt-[calc(var(--editor-topbar-h,73px)+var(--editor-golive-h,0px)+4.5rem)]";
