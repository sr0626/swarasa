// Security page — change password (docs/PROJECT_PLAN.csv "Signed-in account
// dropdown in site header", the Security menu item in
// components/home/AccountMenu.tsx). No dedicated password-change UI existed
// anywhere before this task.
//
// ROUTE CHOICE (flagged in this PR's description): a new `/account/security`
// route rather than a section/anchor on the existing `/account` page. Two
// separate dropdown links ("Profile", "Security") map more naturally onto
// two separate destinations than one page with an in-page anchor — an
// anchor jump is easy to lose track of on a long page (app/account/page.tsx
// already has several stacked sections: profile, follows/managed locations,
// data privacy) and doesn't get its own focus-management/keyboard-Tab
// story the way a real page navigation does. Same auth posture as
// `/account`: every signed-in role can reach it (not gated to owner-only
// like the profile EDIT form is — changing your own password isn't an
// owner-only operation on any contract this app has).
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import ChangePasswordForm from "@/components/account/ChangePasswordForm";

export const metadata: Metadata = {
  title: "Security",
};

export default async function AccountSecurityPage() {
  await requireSession(["owner", "manager", "admin", "registered_user"]);

  return (
    <main className="min-h-screen bg-brand-bg">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link
          href="/account"
          className="text-sm font-medium text-brand-accent transition hover:text-brand-accent-hover"
        >
          ← Back to My Account
        </Link>

        <h1 className="mt-3 font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Security
        </h1>
        <p className="mt-2 text-sm text-brand-ink-muted">Change your account password.</p>

        <div className="mt-6 max-w-2xl">
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  );
}
