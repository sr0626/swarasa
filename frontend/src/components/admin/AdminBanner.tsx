// Dark "Admin console" identity band (avatar, name, email, role badge) shown
// above the admin sidebar + panel on every admin screen. Moved verbatim out
// of AdminAccountView so /account and /admin/* share it via AdminShell.
//
// `nameAs`: the admin's name is the page <h1> on /account (Profile); on
// /admin/* pages the panel owns the <h1> ("Claims Review", ...), so the name
// renders as a plain <p> there to keep exactly one <h1> per page.
import AccountAvatar from "@/components/account/AccountAvatar";
import { ROLE_LABEL, displayNameFor } from "@/components/account/accountShared";
import type { AuthMe } from "@/types/auth";

export default function AdminBanner({
  me,
  nameAs = "p",
}: {
  me: AuthMe;
  nameAs?: "h1" | "p";
}) {
  const Name = nameAs;
  return (
    <header className="rounded-brand-card bg-brand-ink p-5 text-brand-bg shadow-brand-card sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <AccountAvatar me={me} size="sm" className="border-brand-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent-gold">
            Admin console
          </p>
          <Name className="mt-0.5 break-words font-display text-2xl font-bold sm:text-3xl">
            {displayNameFor(me)}
          </Name>
          <p className="mt-0.5 break-all text-sm text-brand-bg/70">{me.email}</p>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center rounded-brand-pill bg-brand-accent-gold px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-ink">
          {ROLE_LABEL[me.role]}
        </span>
      </div>
    </header>
  );
}
