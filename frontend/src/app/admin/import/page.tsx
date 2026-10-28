// Admin bulk listing import — auth-gated (admin only). Template download, CSV
// upload with a dry-run report, then a chunked import with a downloadable
// per-row result. All interaction is in AdminImportPanel (client) via the
// Server Actions in ./actions.ts (docs/API_CONTRACTS.md "Admin bulk listing
// import").
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guards";
import AdminImportPanel from "@/components/admin/AdminImportPanel";

export const metadata: Metadata = {
  title: "Import listings",
};

export default async function AdminImportPage() {
  await requireSession(["admin"]);

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Import listings</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        Add many restaurants at once from a CSV file. You see a row-by-row check first and nothing is
        saved until you confirm.
      </p>
      <div className="mt-6">
        <AdminImportPanel />
      </div>
    </section>
  );
}
