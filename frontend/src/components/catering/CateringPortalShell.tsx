// Owner / manager console frame for the catering inbox pages: picks the
// matching shell for the role.
import type { ReactNode } from "react";
import ManagerShell from "@/components/portal/ManagerShell";
import OwnerShell from "@/components/portal/OwnerShell";
import type { Session } from "@/types/auth";

export default function CateringPortalShell({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  if (session.role === "manager") return <ManagerShell>{children}</ManagerShell>;
  return <OwnerShell>{children}</OwnerShell>;
}
