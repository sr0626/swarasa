// Left-hand identity card on /account, mirroring the restaurant page's
// sidebar info card (RestaurantInfoCard): a warm-gradient banner (same
// `bg-brand-warm-gradient` as the restaurant hero's default image), an
// initials avatar, the user's name/email/role badge, and portal quick
// link (owner/manager). Server Component -- links only, no interactivity.
//
// "Member since" is deliberately absent: GET /auth/me returns no
// created-at for the user (types/auth.ts AuthMe), and we don't fabricate
// data. Add it here when the contract exposes it.
import Link from "next/link";
import AccountAvatar from "@/components/account/AccountAvatar";
import { ROLE_LABEL, displayNameFor } from "@/components/account/accountShared";
import type { AuthMe } from "@/types/auth";

const quickLinkClass =
  "flex min-h-[44px] items-center justify-between gap-2 rounded-brand-control border border-brand-border bg-white px-4 text-sm font-semibold text-brand-ink transition hover:border-brand-ink-subtle hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

export default function AccountSummaryCard({ me }: { me: AuthMe }) {
  const displayName = displayNameFor(me);
  // Admins get their own quick-action grid (AdminAccountView) and diners have
  // no portal, so only owner/manager see a link here.
  const showPortalLink = me.role === "owner" || me.role === "manager";

  return (
    <section
      aria-labelledby="account-summary-heading"
      className="overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card"
    >
      <div aria-hidden="true" className="h-20 bg-brand-warm-gradient" />

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <AccountAvatar me={me} className="-mt-10" />

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

        {showPortalLink && (
          <nav
            aria-label="Portal quick links"
            className="mt-5 flex flex-col gap-2 border-t border-brand-border pt-5"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink-subtle">
              Quick links
            </p>
            <Link href="/portal/dashboard" className={quickLinkClass}>
              Portal dashboard
              <span aria-hidden="true" className="text-brand-ink-subtle">
                →
              </span>
            </Link>
          </nav>
        )}
      </div>
    </section>
  );
}
