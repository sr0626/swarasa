// Business console frame (banner + left menu, "Add a restaurant" active) for
// /portal/brands/new -- the same OwnerShell the owner dashboard and /account
// use. The layout re-checks the owner role, but each page still calls
// requireSession(["owner"]) itself: layouts don't re-render on sibling
// navigation, so a layout alone is not a sufficient guard.
import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/guards";
import { loadConsoleIdentity } from "@/lib/auth/consoleIdentity";
import OwnerShell from "@/components/portal/OwnerShell";

export default async function BrandsLayout({ children }: { children: ReactNode }) {
  const session = await requireSession(["owner"]);
  const me = await loadConsoleIdentity(session);
  return <OwnerShell me={me}>{children}</OwnerShell>;
}
