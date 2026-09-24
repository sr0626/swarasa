// Public "Report a problem / suggest an update" page —
// `/restaurant/{brandSlug}/report`, linked from the restaurant detail page.
// No auth required (docs/API_CONTRACTS.md "POST /reports" is public);
// a signed-in visitor is attributed server-side by the Server Action.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { getRestaurantBySlug, getRestaurantLocations } from "@/lib/api/restaurants";
import { getServerSession } from "@/lib/auth/session";
import { brandHref } from "@/lib/restaurant/urls";
import TopBar from "@/components/home/TopBar";
import ReportProblemForm from "@/components/restaurant/ReportProblemForm";
import type { LocationSummary } from "@/types/location";
import type { RestaurantBrand } from "@/types/restaurant";

interface ReportPageProps {
  params: { brandSlug: string };
  /** `?location={id}` pre-selects the location the visitor came from. */
  searchParams?: { location?: string };
}

export const metadata: Metadata = {
  title: "Report a problem",
  // A form page, not something to index.
  robots: { index: false, follow: false },
};

export default async function ReportPage({ params, searchParams }: ReportPageProps) {
  let restaurant: RestaurantBrand;
  try {
    restaurant = await getRestaurantBySlug(params.brandSlug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  // Best-effort — the location picker is optional, so a failure here must
  // not block reporting.
  let locations: LocationSummary[] = [];
  try {
    const page = await getRestaurantLocations(restaurant.id, { page: 1, page_size: 100 });
    locations = page.results;
  } catch {
    locations = [];
  }

  // Signed-in state is read server-side from the httpOnly session cookie
  // (never client-side). For a signed-in visitor the form shows a read-only
  // "Reporting as ..." note instead of the email input, and the backend
  // takes the email from the verified token regardless of what is sent.
  const session = await getServerSession().catch(() => null);
  const signedInEmail = session?.email ? session.email : null;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-accent">
          Report a problem
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          {restaurant.name}
        </h1>
        <p className="mt-2 text-sm text-brand-ink-muted">
          See something wrong or out of date on this listing? Let us know and
          we&apos;ll take a look.
        </p>

        <div className="mt-6">
          <ReportProblemForm
            brandId={restaurant.id}
            brandName={restaurant.name}
            slug={restaurant.slug}
            locations={locations}
            defaultLocationId={Number(searchParams?.location) || null}
            signedInEmail={signedInEmail}
          />
        </div>

        <p className="mt-4 text-center text-xs text-brand-ink-subtle">
          <Link
            href={brandHref(restaurant.slug)}
            className="font-semibold text-brand-ink underline"
          >
            Back to {restaurant.name}
          </Link>
        </p>
      </section>
    </main>
  );
}
