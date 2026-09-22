// /account for a manager -- rendered inside components/portal/ManagerShell.tsx
// (the shared ConsoleShell: dark identity banner + left menu, same shape as
// the owner and admin consoles — see components/console/ConsoleShell.tsx).
// This component is only the right-hand panel content, top to bottom:
// "Locations I manage" (the default view -- MANAGER_NAV_ITEMS' "My
// locations" item points at plain /account, no anchor) with Edit/Menu
// actions and a note that the owner controls assignment, then the #profile
// section (MANAGER_NAV_ITEMS' "Profile" item) with the editable name form
// and security side by side, then data & privacy last.
//
// REDESIGN (this PR): previously rendered standalone inside a plain <main>
// with its own identity header and a "Go to the portal dashboard" link --
// both removed now that the identity banner comes from ManagerShell and
// /portal/dashboard is just a redirect back to this same page (see that
// route's own comment for the stale-bug fix).
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import ManagedLocationsPanel from "@/components/account/ManagedLocationsPanel";
import NameEditForm from "@/components/account/NameEditForm";
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
    <div className="flex flex-col gap-5">
      <ManagedLocationsPanel locations={locations} loadError={locationsError} />

      <div id="profile" className="grid scroll-mt-24 grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
        {me.owner_account ? (
          // Defensive only -- a manager session never actually has an
          // owner_account (see AuthMe's own comment), but if the backend
          // ever did return one, prefer showing it over the generic form.
          <AccountDetailsCard me={me} stacked />
        ) : (
          <NameEditForm currentName={me.full_name} email={me.email} />
        )}
        <SecurityCard />
      </div>

      <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
    </div>
  );
}
