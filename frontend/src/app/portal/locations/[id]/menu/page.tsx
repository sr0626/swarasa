// The menu is managed inside the location editor itself (its "Menu"
// section, alongside hours, deals and photos) — this route only exists so
// the path reserved in frontend/CLAUDE.md's Directory Structure (and the
// "Menu" buttons that link here) keep working. Same role gate as the
// editor; the editor re-checks access. Mirrors the deals route.
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";

interface LocationMenuPageProps {
  params: { id: string };
}

export default async function LocationMenuPage({ params }: LocationMenuPageProps) {
  await requireSession(["owner", "manager", "admin"]);
  redirect(`/portal/locations/${encodeURIComponent(params.id)}#menu`);
}
