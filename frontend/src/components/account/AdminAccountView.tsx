// /account for an admin: operations-console feel. A dark header band with the
// admin's identity and role badge, a quick-action grid into the existing
// admin pages, then account details + security. No followed-restaurants or
// business sections. Server Component.
import Link from "next/link";
import AccountAvatar from "@/components/account/AccountAvatar";
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import SecurityCard from "@/components/account/SecurityCard";
import { ROLE_LABEL, displayNameFor } from "@/components/account/accountShared";
import { ClipboardCheckIcon, FlagIcon, StoreIcon } from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
import type { AuthMe } from "@/types/auth";
import type { DataDeletionRequest } from "@/types/privacy";

interface AdminAction {
  href: string;
  title: string;
  description: string;
  Icon: (props: IconProps) => JSX.Element;
}

// Every admin page that exists under app/admin. Add a row here when a new
// admin page lands (e.g. the data-deletion review queue).
const ADMIN_ACTIONS: AdminAction[] = [
  {
    href: "/admin/claims",
    title: "Claims",
    description: "Approve or reject restaurant ownership claims.",
    Icon: ClipboardCheckIcon,
  },
  {
    href: "/admin/reports",
    title: "Reports",
    description: "Review problems visitors flagged on listings.",
    Icon: FlagIcon,
  },
  {
    href: "/admin/listings",
    title: "Listings",
    description: "Browse every restaurant, delete a listing or deactivate a location.",
    Icon: StoreIcon,
  },
];

export default function AdminAccountView({
  me,
  latestDeletionRequest,
}: {
  me: AuthMe;
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-brand-card bg-brand-ink p-5 text-brand-bg shadow-brand-card sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <AccountAvatar me={me} size="sm" className="border-brand-ink" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent-gold">
              Admin console
            </p>
            <h1 className="mt-0.5 break-words font-display text-2xl font-bold sm:text-3xl">
              {displayNameFor(me)}
            </h1>
            <p className="mt-0.5 break-all text-sm text-brand-bg/70">{me.email}</p>
          </div>
          <span className="inline-flex w-fit shrink-0 items-center rounded-brand-pill bg-brand-accent-gold px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-ink">
            {ROLE_LABEL[me.role]}
          </span>
        </div>
      </header>

      <nav aria-label="Admin tools">
        <h2 className="font-display text-xl font-bold text-brand-ink">Quick actions</h2>
        <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_ACTIONS.map(({ href, title, description, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex h-full min-h-[44px] items-start gap-4 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card transition hover:border-brand-ink-subtle hover:shadow-brand-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-brand-control bg-brand-chip text-brand-chip-ink">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-display text-lg font-bold text-brand-ink group-hover:text-brand-accent">
                    {title}
                    <span aria-hidden="true" className="text-brand-ink-subtle">
                      →
                    </span>
                  </span>
                  <span className="mt-1 block text-sm text-brand-ink-muted">{description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <AccountDetailsCard me={me} />
        <SecurityCard />
      </div>

      <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
    </div>
  );
}
