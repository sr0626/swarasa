// Small "Sign in to see deals" call-to-action shown next to the content-free
// DealBadge, for SIGNED-OUT visitors only (callers decide — never rendered
// for any signed-in role). A plain <Link> to /login?next=<current page>, the
// same mechanism as FollowButton's signed-out state (lib/auth/safeNext.ts (dealSignInHref)).
// The login page also offers "Create an account", preserving `next`.
//
// Must not be rendered inside another <a> (invalid HTML) — RestaurantCard
// places it in the tile's bottom section, outside the tile's own link, the
// same way it places the follow icon.
//
// Touch target: `min-h-11` (44px) per frontend/CLAUDE.md "Mobile-First
// Rules". Contrast: text-brand-accent on the white card / page background,
// the same colour pairing the badge itself uses.
import Link from "next/link";
import { dealSignInHref } from "@/lib/auth/safeNext";

export default function DealSignInLink({
  currentPath,
  className = "",
}: {
  currentPath: string;
  className?: string;
}) {
  return (
    <Link
      href={dealSignInHref(currentPath)}
      className={`inline-flex min-h-11 items-center rounded-brand-control text-xs font-semibold text-brand-accent underline underline-offset-2 hover:text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 ${className}`}
    >
      Sign in to see deals
    </Link>
  );
}
