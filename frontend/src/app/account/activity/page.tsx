// Activity view for owners and managers -- opened from the "Activity" item in
// the console's left menu (OWNER_NAV_ITEMS / MANAGER_NAV_ITEMS). This used to
// be an always-visible "Recent activity" section on /account; it is its own
// page now so /account no longer fetches GET /auth/me/activity at all and the
// feed is only loaded when someone asks for it.
//
// Role scope is unchanged and enforced server-side by the endpoint: an owner
// gets their own brands/locations (incl. manager edits), a manager only the
// customer-facing changes on their assigned locations. Admins and diners have
// no activity feed and are sent back to /account. The first page is
// server-rendered; "Load more" is client-side via getMyActivityAction.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";
import { loadConsoleIdentity } from "@/lib/auth/consoleIdentity";
import { ApiError } from "@/lib/api/client";
import { getMyActivity } from "@/lib/api/auth";
import ManagerShell from "@/components/portal/ManagerShell";
import OwnerShell from "@/components/portal/OwnerShell";
import OwnerActivitySection from "@/components/account/OwnerActivitySection";
import type { OwnerActivity } from "@/types/activity";
import type { PaginatedResponse } from "@/types/common";

export const metadata: Metadata = {
  title: "Activity",
};

export default async function AccountActivityPage() {
  const session = await requireSession(["owner", "manager", "admin", "registered_user"]);
  if (session.role !== "owner" && session.role !== "manager") {
    redirect("/account");
  }

  let activityPage: PaginatedResponse<OwnerActivity> | null = null;
  let activityError: string | null = null;
  try {
    activityPage = await getMyActivity({ page: 1, page_size: 20 }, session.accessToken);
  } catch (error) {
    activityError =
      error instanceof ApiError
        ? error.message
        : "Could not load recent activity. Please try again.";
  }

  const me = await loadConsoleIdentity(session);

  if (session.role === "manager") {
    return (
      <ManagerShell me={me}>
        <OwnerActivitySection
          initialPage={activityPage}
          loadError={activityError}
          heading="Recent activity"
          description="Address, hours, and listing changes on the locations you manage."
          headingAs="h1"
        />
      </ManagerShell>
    );
  }

  return (
    <OwnerShell me={me}>
      <OwnerActivitySection initialPage={activityPage} loadError={activityError} headingAs="h1" />
    </OwnerShell>
  );
}
