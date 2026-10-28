// Admin taxonomy management — auth-gated (admin only). Backed by
// `GET /admin/taxonomy` (docs/API_CONTRACTS.md "Admin taxonomy management"):
// every cuisine / dietary / restaurant-type / signature / dining-time tag with
// usage counts and active state. Add / rename / deactivate go through the
// Server Actions in ./actions.ts (via AdminTaxonomyPanel).
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guards";
import InfoPanel from "@/components/ui/InfoPanel";
import AdminTaxonomyPanel from "@/components/admin/AdminTaxonomyPanel";
import { ApiError } from "@/lib/api/client";
import { getAdminTaxonomy } from "@/lib/api/adminTaxonomy";
import type { AdminTag } from "@/types/adminTaxonomy";

export const metadata: Metadata = {
  title: "Taxonomy",
};

export default async function AdminTaxonomyPage() {
  const session = await requireSession(["admin"]);

  let tags: AdminTag[] = [];
  let loadError: string | null = null;
  try {
    tags = (await getAdminTaxonomy(session.accessToken)).results;
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "Something went wrong loading the taxonomy. Please try again.";
  }

  return (
    <section>
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Taxonomy</h1>
      <p className="mt-2 text-sm text-brand-ink-muted">
        The cuisine, dietary and restaurant-type tags owners can pick and diners can filter by.
        Deactivating a tag hides it from pickers, search filters and public pages without deleting
        anything; tags are never deleted.
      </p>

      <div className="mt-6">
        {loadError ? (
          <InfoPanel title="Couldn't load the taxonomy" body={loadError} />
        ) : (
          <AdminTaxonomyPanel initialTags={tags} />
        )}
      </div>
    </section>
  );
}
