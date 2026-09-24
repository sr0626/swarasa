// Shared Tailwind class for every jump-link target in the location editor:
// leaves room for the sticky site header (its height is published as
// `--editor-topbar-h` by EditorSectionNav, 73px until then) plus the sticky
// section-link row (~3.5rem) plus the sticky Go-live bar when the listing is in
// setup (its height is published as `--editor-golive-h`, 0 otherwise) plus a
// little air, so a target is never hidden
// underneath them. Lives in a plain .ts under components/ (not lib/) so
// Tailwind's content globs see the class, and is not a "use client" module so
// server components can import the string.
export const SECTION_ANCHOR_CLASS = "scroll-mt-[calc(var(--editor-topbar-h,73px)+var(--editor-golive-h,0px)+4.5rem)]";
