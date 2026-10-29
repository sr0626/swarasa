// Compact stat chips shown above an admin people/report table: label + figure,
// wrapping on narrow screens (no horizontal scroll at 375px). Numbers are real
// text and each chip carries its label, so tone (muted / amber) is never the
// only signal. Counts cover the whole dataset, not the current search/filter.
//
// Wrapped in a CollapsiblePanel, collapsed by default (the user's choice is
// remembered per page); the collapsed header keeps a one-line hint of the
// headline figures so nothing important is lost by collapsing.
import CollapsiblePanel from "@/components/ui/CollapsiblePanel";
import { summaryHint, type SummaryChip, type SummaryTone } from "@/lib/adminSummary";

const TONE_CLASSES: Record<SummaryTone, string> = {
  neutral: "border-brand-border bg-white text-brand-ink",
  inactive: "border-brand-border bg-brand-chip text-brand-chip-ink",
  warning: "border-brand-closed bg-brand-closed-bg text-brand-closed",
};

export default function AdminSummaryStrip({
  page,
  heading = "Summary",
  chips,
  note,
}: {
  /** Page id used to remember the open/closed choice, e.g. "users". */
  page: string;
  heading?: string;
  chips: SummaryChip[];
  /** Optional caption below the chips (e.g. the cap warning). */
  note?: string | null;
}) {
  return (
    <CollapsiblePanel page={page} panel="summary" title={heading} hint={summaryHint(chips)}>
      <section aria-label={`${heading}: all records, unaffected by search and filters`}>
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li
              key={chip.label}
              className={`flex min-w-0 items-baseline gap-2 rounded-brand-control border px-3 py-2 shadow-brand-control ${TONE_CLASSES[chip.tone]}`}
            >
              <span className="font-display text-lg font-bold leading-none">{chip.value}</span>
              <span className="text-xs font-medium">{chip.label}</span>
            </li>
          ))}
        </ul>
        {note && <p className="mt-2 text-xs text-brand-ink-subtle">{note}</p>}
      </section>
    </CollapsiblePanel>
  );
}
