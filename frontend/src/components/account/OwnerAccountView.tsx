// /account for an owner: the "Profile & account" panel of the business
// console. The dark "Business account" banner and the left menu (My
// restaurants / Add a restaurant / Profile & account) come from
// components/portal/OwnerShell.tsx, which app/account/page.tsx wraps around
// this view -- this component only renders the right-hand panel: business
// profile edit form (or read-only details when there is no owner record),
// security, and data export/delete. Restaurants live on /portal/dashboard.
// Server Component.
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import ProfileEditForm from "@/components/account/ProfileEditForm";
import SecurityCard from "@/components/account/SecurityCard";
import type { AuthMe } from "@/types/auth";
import type { DataDeletionRequest } from "@/types/privacy";

export default function OwnerAccountView({
  me,
  latestDeletionRequest,
}: {
  me: AuthMe;
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
        {me.owner_account ? (
          <ProfileEditForm ownerAccount={me.owner_account} />
        ) : (
          <AccountDetailsCard me={me} />
        )}
        <SecurityCard />
      </div>

      <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
    </div>
  );
}
