// Dark identity band (avatar, name, email, role badge) shown above the left
// menu + panel of every role console (admin, owner; manager later). Generalised
// from the admin banner -- `label` is the gold eyebrow ("Admin console",
// "Business account"), everything else is identical.
//
// `nameAs`: on profile-style pages the user's name is the page <h1>; on pages
// where the panel owns the <h1> ("Claims Review", "My restaurants", ...) the
// name renders as a plain <p> so there is exactly one <h1> per page.
import AccountAvatar from "@/components/account/AccountAvatar";
import { ROLE_LABEL, displayNameFor } from "@/components/account/accountShared";
import type { AuthMe } from "@/types/auth";

export default function ConsoleBanner({
  me,
  label,
  nameAs = "p",
}: {
  me: AuthMe;
  label: string;
  nameAs?: "h1" | "p";
}) {
  const Name = nameAs;
  return (
    <header className="rounded-brand-card bg-brand-ink p-5 text-brand-bg shadow-brand-card sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <AccountAvatar me={me} size="sm" className="border-brand-ink" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent-gold">
            {label}
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
