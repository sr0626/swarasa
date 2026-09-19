// New restaurant brand — owner-only (POST /restaurants is "Auth: owner",
// docs/API_CONTRACTS.md). Landing spot for the site header's "Add Your
// Restaurant" CTA for a signed-in owner (see TopBarShell.tsx's header
// comment for the routing decision across all four roles) and for the
// owner dashboard's "create a new brand" empty-state link. Rendered inside
// the business console frame by app/portal/brands/layout.tsx (no own
// <main>/TopBar; the left menu replaces the old "Back to dashboard" link).
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guards";
import { getCuisineTags } from "@/lib/api/cuisine";
import CreateBrandForm from "@/components/portal/CreateBrandForm";
import type { CuisineTag } from "@/types/cuisine";

export const metadata: Metadata = {
  title: "Add Your Restaurant",
};

export default async function NewBrandPage() {
  await requireSession(["owner"]);

  let cuisineTags: CuisineTag[] = [];
  try {
    cuisineTags = await getCuisineTags();
  } catch {
    // Non-fatal — CreateBrandForm renders without tag picking when this
    // public, best-effort lookup fails, same graceful-degradation posture
    // as the rest of the portal (frontend/CLAUDE.md "ALWAYS handle API
    // errors gracefully").
    cuisineTags = [];
  }

  return (
    <section className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
        Add Your Restaurant
      </h1>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Tell us about your restaurant and where to find it. You can add hours and photos next.
      </p>

      <div className="mt-6 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
        <CreateBrandForm cuisineTags={cuisineTags} />
      </div>
    </section>
  );
}
