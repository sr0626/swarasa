// /account for a manager: compact and task-focused. A slim identity strip,
// the "Locations I manage" list front and center (Edit / Menu actions, with a
// note that the owner controls assignment), then minimal account details and
// the security link side by side, and the privacy controls last. Single
// narrower column at every width — deliberately not the two-column
// dashboard layout the owner gets.
import Link from "next/link";
import AccountAvatar from "@/components/account/AccountAvatar";
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import ManagedLocationsPanel from "@/components/account/ManagedLocationsPanel";
import SecurityCard from "@/components/account/SecurityCard";
import { ROLE_LABEL, cardClass, displayNameFor } from "@/components/account/accountShared";
import type { ManagedLocationWithStatus } from "@/lib/manager/loadManagedLocationStatuses";
import type { AuthMe } from "@/types/auth";
import type { DataDeletionRequest } from "@/types/privacy";

export default function ManagerAccountView({
  me,
  locations,
  locationsError,
  latestDeletionRequest,
}: {
  me: AuthMe;
  locations: ManagedLocationWithStatus[];
  locationsError: string | null;
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className={`${cardClass} flex items-center gap-4`}>
        <AccountAvatar me={me} size="sm" />
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-display text-xl font-bold text-brand-ink sm:text-2xl">
            {displayNameFor(me)}
          </h1>
          <p className="mt-0.5 break-words text-sm text-brand-ink-muted">{me.email}</p>
        </div>
        <span className="shrink-0 rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
          {ROLE_LABEL[me.role]}
        </span>
      </header>

      <ManagedLocationsPanel locations={locations} loadError={locationsError} />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
        <AccountDetailsCard me={me} stacked />
        <SecurityCard />
      </div>

      <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />

      <p className="text-center text-sm text-brand-ink-subtle">
        Looking for the rest of the tools?{" "}
        <Link
          href="/portal/dashboard"
          className="font-semibold text-brand-accent hover:text-brand-accent-hover"
        >
          Go to the portal dashboard
        </Link>
      </p>
    </div>
  );
}
