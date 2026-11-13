// Owner / manager console frame for the catering inbox pages (server
// component): resolves the banner identity and picks the matching shell.
import type { ReactNode } from "react";
import ManagerShell from "@/components/portal/ManagerShell";
import OwnerShell from "@/components/portal/OwnerShell";
import { loadConsoleIdentity } from "@/lib/auth/consoleIdentity";
import type { Session } from "@/types/auth";

export default async function CateringPortalShell({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const me = await loadConsoleIdentity(session);
  if (session.role === "manager") return <ManagerShell me={me}>{children}</ManagerShell>;
  return <OwnerShell me={me}>{children}</OwnerShell>;
}
