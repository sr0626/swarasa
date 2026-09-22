// Read-only "Account details" card for roles that can't edit their profile
// from a form of their own. PATCH /auth/me's full owner_account form
// (docs/API_CONTRACTS.md; see components/account/ProfileEditForm.tsx) is
// still owner-only, so this card keeps its "not available" note by
// default. registered_user/manager gained a real (if narrower) name edit
// via components/account/DisplayNameForm.tsx, which the account page
// renders separately just above this card — pass `nameEditableElsewhere`
// for those roles so this card doesn't show a stale "editing isn't
// available" note directly under a form that just proved otherwise; admin
// (no local profile source at all yet) keeps the default note.
import type { AuthMe } from "@/types/auth";

export default function AccountDetailsCard({
  me,
  stacked = false,
  nameEditableElsewhere = false,
}: {
  me: AuthMe;
  /** One field per row (narrow side columns) instead of two side by side. */
  stacked?: boolean;
  /** True when a name edit form is rendered elsewhere on this page for this role. */
  nameEditableElsewhere?: boolean;
}) {
  return (
    <section
      aria-labelledby="account-details-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="account-details-heading" className="font-display text-xl font-bold text-brand-ink">
        Account details
      </h2>

      <dl className={`mt-4 grid grid-cols-1 gap-4 ${stacked ? "" : "sm:grid-cols-2"}`}>
        <div>
          <dt className="text-sm font-semibold text-brand-ink">Name</dt>
          <dd className="mt-1 break-words text-sm text-brand-ink-muted">
            {me.full_name ?? "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-brand-ink">Email</dt>
          <dd className="mt-1 break-all text-sm text-brand-ink-muted">{me.email}</dd>
        </div>
      </dl>

      {!nameEditableElsewhere && (
        <p className="mt-4 rounded-brand-control bg-brand-bg px-3 py-2.5 text-sm text-brand-ink-muted">
          Profile editing isn&apos;t available for this role yet. Name/email changes are currently
          owner-only. Contact support if your details need to change.
        </p>
      )}
    </section>
  );
}
