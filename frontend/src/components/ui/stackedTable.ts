// A table that becomes a list of cards on phones (below `md`), instead of a
// wide table cut off at the screen edge. Each cell shows its column name from
// `data-label`; the first cell of a row (the person or item) takes the full
// width without a label. Used by the admin report tables.

/** The header row stays for screen readers, hidden visually on phones. */
export const STACKED_HEAD = "max-md:sr-only";

export const STACKED_ROW =
  "border-b border-brand-border last:border-0 max-md:block max-md:py-2";

/** First cell of a row. */
export const STACKED_TITLE_CELL = "break-words px-4 py-3 max-md:block max-md:py-1.5";

/** Every other cell: add `data-label="Column name"` next to this class. */
export const STACKED_CELL =
  "px-4 py-3 max-md:flex max-md:min-h-[32px] max-md:items-center max-md:justify-between max-md:gap-4 max-md:py-1 max-md:text-right max-md:before:shrink-0 max-md:before:text-left max-md:before:text-xs max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-brand-ink-subtle max-md:before:content-[attr(data-label)]";

/** A link inside a row or heading: a full-height tap target on phones only. */
export const PHONE_TAP_LINK =
  "max-md:inline-flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center";
