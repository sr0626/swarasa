// Deals are managed inside the location editor itself (its "Deals &
// specials" section, alongside hours and photos) — this route only exists
// so the path reserved in frontend/CLAUDE.md's Directory Structure keeps
// working. Same role gate as the editor; the editor re-checks access.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";

interface LocationDealsPageProps {
  params: { id: string };
}

export default async function LocationDealsPage({ params }: LocationDealsPageProps) {
  await requireSession(["owner", "manager", "admin"]);
  redirect(`/portal/locations/${encodeURIComponent(params.id)}#deals`);
}
