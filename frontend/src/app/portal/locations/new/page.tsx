// "Add location" — another branch of an existing restaurant
// (`/portal/locations/new?brand={brandId}`). Reached from the "Add location"
// button on each owner brand card and on an admin's listing row. Owner (of that
// brand — re-checked by POST /locations) or admin only; a manager can't add
// locations. Before this, the only way to get a second location was "Add
// restaurant", which always makes a NEW brand — hence duplicate brands for the
// same restaurant.
import type { Metadata } from "next";
import Link from "next/link";
import TopBar from "@/components/home/TopBar";
import AddLocationForm from "@/components/portal/AddLocationForm";
import InfoPanel from "@/components/ui/InfoPanel";
import { getCuisineTags } from "@/lib/api/cuisine";
import { getRestaurantById, getRestaurantLocations } from "@/lib/api/restaurants";
import { requireSession } from "@/lib/auth/guards";
import type { CuisineTag } from "@/types/cuisine";
import type { RestaurantBrand } from "@/types/restaurant";

export const metadata: Metadata = {
  title: "Add Location",
};

interface AddLocationPageProps {
  searchParams?: { brand?: string | string[] };
}

function parseBrandId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export default async function AddLocationPage({ searchParams }: AddLocationPageProps) {
  const brandId = parseBrandId(searchParams?.brand);
  const returnTo = brandId ? `/portal/locations/new?brand=${brandId}` : "/account";
  const session = await requireSession(["owner", "admin"], returnTo);

  const home =
    session.role === "admin"
      ? { href: "/admin/listings", label: "Back to listings" }
      : { href: "/account", label: "Back to your business account" };

  let brand: RestaurantBrand | null = null;
  if (brandId !== null) {
    try {
      brand = await getRestaurantById(brandId);
    } catch {
      brand = null;
    }
  }

  // Tags are per location: the picker is pre-filled with the tags of the brand's FIRST
  // location (lowest id — the same one the backend copies from), so the owner doesn't retype
  // them. Best-effort: on any failure the picker is simply hidden and the backend still
  // copies the first location's tags itself.
  let cuisineTags: CuisineTag[] = [];
  let initialTagIds: number[] = [];
  if (brand !== null) {
    try {
      const [all, locations] = await Promise.all([
        getCuisineTags(),
        getRestaurantLocations(brand.id, { page_size: 100 }, session.accessToken),
      ]);
      cuisineTags = all;
      const first = [...locations.results].sort((a, b) => a.id - b.id)[0];
      initialTagIds = first ? first.cuisine_tags.map((tag) => tag.id) : [];
    } catch {
      cuisineTags = [];
      initialTagIds = [];
    }
  }

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        {brand === null ? (
          <>
            <InfoPanel
              title="Restaurant not found"
              body="We couldn't find that restaurant. Open “Add location” from the restaurant's card instead."
            />
            <Link
              href={home.href}
              className="mt-6 inline-flex min-h-[44px] items-center rounded-brand-pill bg-brand-ink px-5 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
            >
              {home.label}
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
              Add a location to {brand.name}
            </h1>
            <p className="mt-1 text-sm text-brand-ink-muted">
              A second branch, food truck or new address of the same restaurant — it shares this
              restaurant&rsquo;s name and owner; its cuisine tags can differ.
            </p>
            <div className="mt-6 rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6">
              <AddLocationForm
                brandId={brand.id}
                brandName={brand.name}
                cancelHref={home.href}
                cuisineTags={cuisineTags}
                initialTagIds={initialTagIds}
              />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
