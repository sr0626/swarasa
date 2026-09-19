// /account for an admin: the Profile panel of the admin console. The dark
// "Admin console" banner and the left menu (Profile / Claims / Reports /
// Listings) come from components/admin/AdminShell.tsx, which app/account/
// page.tsx wraps around this view -- this component only renders the right-
// hand panel: account details + security + data/privacy. No followed-
// restaurants or business sections. Server Component.
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import SecurityCard from "@/components/account/SecurityCard";
import type { AuthMe } from "@/types/auth";
import type { DataDeletionRequest } from "@/types/privacy";

export default function AdminAccountView({
  me,
  latestDeletionRequest,
}: {
  me: AuthMe;
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
        <AccountDetailsCard me={me} />
        <SecurityCard />
      </div>

      <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
    </div>
  );
}
