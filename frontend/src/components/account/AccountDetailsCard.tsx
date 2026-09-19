// Read-only "Account details" card for roles that can't edit their profile.
// PATCH /auth/me is owner-only (docs/API_CONTRACTS.md; see
// components/account/ProfileEditForm.tsx), so manager/admin/registered_user
// get their details displayed plus the same "not available for this role
// yet" note the page previously showed as a standalone panel.
import type { AuthMe } from "@/types/auth";

export default function AccountDetailsCard({ me }: { me: AuthMe }) {
  return (
    <section
      aria-labelledby="account-details-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2 id="account-details-heading" className="font-display text-xl font-bold text-brand-ink">
        Account details
      </h2>

      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-brand-ink">Name</dt>
          <dd className="mt-1 break-words text-sm text-brand-ink-muted">
            {me.owner_account?.full_name ?? "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-brand-ink">Email</dt>
          <dd className="mt-1 break-all text-sm text-brand-ink-muted">{me.email}</dd>
        </div>
      </dl>

      <p className="mt-4 rounded-brand-control bg-brand-bg px-3 py-2.5 text-sm text-brand-ink-muted">
        Profile editing isn&apos;t available for this role yet. Name/email changes are currently
        owner-only. Contact support if your details need to change.
      </p>
    </section>
  );
}
