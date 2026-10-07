// /account for an admin: the Profile panel of the admin console. The dark
// "Admin console" banner and the left menu (Profile / Claims / Reports /
// Listings) come from components/admin/AdminShell.tsx, which app/account/
// page.tsx wraps around this view -- this component only renders the right-
// hand panel: account details + security. (Data export / deletion lives at /privacy, which shows admins a note instead.) No followed-
// restaurants or business sections. Server Component.
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import SecurityCard from "@/components/account/SecurityCard";
import type { AuthMe } from "@/types/auth";

export default function AdminAccountView({ me }: { me: AuthMe }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
        <AccountDetailsCard me={me} />
        <SecurityCard />
      </div>
    </div>
  );
}
