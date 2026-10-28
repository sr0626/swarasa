// "Searching near ZIP 75201 — change" note for a signed-in diner whose saved
// ZIP is the search origin (lib/search/searchOrigin.ts). Server component, no
// client JS: "change" is a plain link to the account page's location form.
// The link is a 44px-tall tap target; the text wraps at 375px.
import Link from "next/link";
import { LocationPinIcon } from "@/components/ui/icons";

interface SearchOriginNoteProps {
  text: string;
  /** false = the saved ZIP could not be placed (muted, still offers "change"). */
  resolved?: boolean;
}

export default function SearchOriginNote({ text, resolved = true }: SearchOriginNoteProps) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-1 text-sm text-brand-ink-muted"
      data-testid="search-origin-note"
    >
      <LocationPinIcon className="h-4 w-4 shrink-0 text-brand-ink-subtle" aria-hidden="true" />
      <span className={resolved ? undefined : "italic"}>{text}</span>
      <span aria-hidden="true">&mdash;</span>
      <Link
        href="/account#location"
        className="inline-flex min-h-[44px] items-center font-semibold text-brand-accent underline-offset-2 hover:underline"
      >
        change<span className="sr-only"> your saved location</span>
      </Link>
    </p>
  );
}
