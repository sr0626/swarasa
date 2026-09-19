// Left-hand identity card on /account, mirroring the restaurant page's
// sidebar info card (RestaurantInfoCard): a warm-gradient banner (same
// `bg-brand-warm-gradient` as the restaurant hero's default image), an
// initials avatar, the user's name/email/role badge, and role-aware quick
// links. Server Component -- links only, no interactivity.
//
// "Member since" is deliberately absent: GET /auth/me returns no
// created-at for the user (types/auth.ts AuthMe), and we don't fabricate
// data. Add it here when the contract exposes it.
import Link from "next/link";
import type { AuthMe } from "@/types/auth";

const ROLE_LABEL: Record<AuthMe["role"], string> = {
  owner: "Owner",
  manager: "Manager",
  admin: "Admin",
  registered_user: "Registered user",
};

interface QuickLink {
  href: string;
  label: string;
}

const ADMIN_LINKS: QuickLink[] = [
  { href: "/admin/claims", label: "Claims" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/listings", label: "Listings" },
];

/** Up to two initials from the display name; falls back to the email's
 * first character so the avatar is never empty. */
function initialsFor(name: string | null, email: string): string {
  const source = name?.trim() ?? "";
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return `${first}${last}`.toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

const quickLinkClass =
  "flex min-h-[44px] items-center justify-between gap-2 rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

export default function AccountSummaryCard({ me }: { me: AuthMe }) {
  const displayName = me.owner_account?.full_name?.trim() || me.email;
  const links: QuickLink[] =
    me.role === "admin"
      ? ADMIN_LINKS
      : me.role === "owner" || me.role === "manager"
        ? [{ href: "/portal/dashboard", label: "Portal dashboard" }]
        : [];

  return (
    <section
      aria-labelledby="account-summary-heading"
      className="overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card"
    >
      <div aria-hidden="true" className="h-20 bg-brand-warm-gradient" />

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div
          aria-hidden="true"
          className="-mt-10 flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-brand-chip font-display text-2xl font-bold text-brand-chip-ink shadow-brand-control"
        >
          {initialsFor(me.owner_account?.full_name ?? null, me.email)}
        </div>

        <h2
          id="account-summary-heading"
          className="mt-3 break-words font-display text-xl font-bold text-brand-ink"
        >
          {displayName}
        </h2>
        <p className="mt-1 break-all text-sm text-brand-ink-muted">{me.email}</p>
        <span className="mt-3 inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
          {ROLE_LABEL[me.role]}
        </span>

        {links.length > 0 && (
          <nav
            aria-label={me.role === "admin" ? "Admin quick links" : "Portal quick links"}
            className="mt-5 flex flex-col gap-2 border-t border-brand-border pt-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
              {me.role === "admin" ? "Admin" : "Quick links"}
            </p>
            {links.map((link) => (
              <Link key={link.href} href={link.href} className={quickLinkClass}>
                {link.label}
                <span aria-hidden="true" className="text-brand-ink-subtle">
                  →
                </span>
              </Link>
            ))}
          </nav>
        )}
      </div>
    </section>
  );
}
