// The "Deal(s) available today" signal AS the sign-in link, for SIGNED-OUT
// visitors only (callers decide — never rendered for a signed-in viewer, who
// gets the full deal content since 2026-09-25). Product decision
// 2026-09-23: instead of a badge plus a separate "Sign in to see deals" text
// link, the badge/pane ITSELF is the link, so the whole signal is one
// tappable target. It goes to /login?next=<current page> via
// `dealSignInHref()` (lib/auth/safeNext.ts), the same mechanism as
// FollowButton's signed-out state; the login page also offers "Create an
// account", preserving `next`.
//
// Two sizes:
//   - "badge"  — search tiles / "Popular near you": the familiar pill, same
//                look as DealBadge, wrapped in a link with a 44px-high hit
//                area.
//   - "banner" — restaurant detail page: a larger, prominent full-width
//                tappable pane (bigger text/padding, arrow, min 56px tall).
//
// Content-free by design: says only that a deal exists, never what it is.
//
// Must not be rendered inside another <a> (invalid HTML) — RestaurantCard
// places it as a sibling of the tile's own link (an overlay on the cover's
// bottom-left, `overlay` prop), the same way it places the follow icon.
//
// Accessibility: a real <Link> (keyboard focusable, Enter activates), a
// visible focus ring, an accessible name that says where it goes, 44px+
// touch target (frontend/CLAUDE.md "Mobile-First Rules"). Contrast is the
// same accent-on-tint pairing DealBadge already uses (text-brand-accent on
// bg-brand-accent/10); the helper line uses text-brand-ink.
import Link from "next/link";
import { TagIcon } from "@/components/ui/icons";
import { dealSignInHref } from "@/lib/auth/safeNext";

const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2";

const ACCESSIBLE_NAME = "Deal(s) available today — sign in to see today's deals";

export default function DealSignInLink({
  currentPath,
  variant = "badge",
  overlay = false,
  className = "",
}: {
  currentPath: string;
  variant?: "badge" | "banner";
  /** Badge variant only: solid-white pill + side padding for sitting over a
   * cover photo (see DealBadge `variant="overlay"`). */
  overlay?: boolean;
  className?: string;
}) {
  const href = dealSignInHref(currentPath);

  if (variant === "banner") {
    return (
      <Link
        href={href}
        aria-label={ACCESSIBLE_NAME}
        className={`group flex min-h-14 w-full items-center gap-3 rounded-brand-card border border-brand-accent/30 bg-brand-accent/10 px-4 py-3 transition hover:bg-brand-accent/15 sm:px-5 sm:py-4 ${FOCUS_RING} ${className}`}
      >
        <TagIcon className="h-6 w-6 shrink-0 text-brand-accent" />
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-bold text-brand-accent sm:text-lg">
            Deal(s) available today
          </span>
          <span className="text-sm text-brand-ink">Sign in to see today&apos;s deals</span>
        </span>
        <span
          aria-hidden="true"
          className="ml-auto shrink-0 text-xl text-brand-accent transition group-hover:translate-x-0.5"
        >
          &rarr;
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-label={ACCESSIBLE_NAME}
      className={`inline-flex min-h-11 items-center rounded-brand-pill ${overlay ? "px-2" : ""} ${FOCUS_RING} ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-brand-pill px-2.5 py-1 text-xs font-semibold text-brand-accent underline underline-offset-2 ${
          overlay
            ? "bg-white shadow-brand-card ring-1 ring-brand-accent/20 hover:bg-brand-accent/5"
            : "bg-brand-accent/10 hover:bg-brand-accent/15"
        }`}
      >
        <TagIcon className="h-3.5 w-3.5" />
        Deal(s) available today
      </span>
    </Link>
  );
}
