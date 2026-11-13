// "Request catering quote" — signed-in registered users only. A 3-step flow
// (details -> choose restaurants -> review) in CateringRequestWizard. An
// optional `?location=<id>` (the "Get catering quotes" link on a restaurant's
// page) pre-selects that restaurant when it is currently eligible.
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import InfoPanel from "@/components/ui/InfoPanel";
import CateringRequestWizard from "@/components/catering/CateringRequestWizard";
import { ApiError } from "@/lib/api/client";
import { getCateringConfig, getCateringEligibility } from "@/lib/api/catering";
import type { CateringConfig } from "@/types/catering";

export const metadata: Metadata = {
  title: "Request catering quotes",
};

interface NewCateringPageProps {
  searchParams: { location?: string };
}

export default async function NewCateringRequestPage({ searchParams }: NewCateringPageProps) {
  const locationParam = Number.parseInt(searchParams.location ?? "", 10);
  const returnTo =
    Number.isInteger(locationParam) && locationParam > 0
      ? `/account/catering/new?location=${locationParam}`
      : "/account/catering/new";
  const session = await requireSession(["registered_user"], returnTo);

  let config: CateringConfig | null = null;
  let loadError: string | null = null;
  try {
    config = await getCateringConfig(session.accessToken);
  } catch (error) {
    loadError =
      error instanceof ApiError
        ? error.message
        : "We couldn't load the catering form. Please try again.";
  }

  const initialRestaurant =
    Number.isInteger(locationParam) && locationParam > 0
      ? await getCateringEligibility(locationParam)
      : null;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <Link
          href="/account/catering"
          className="inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-ink-muted underline"
        >
          Back to my catering requests
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          Request catering quotes
        </h1>
        <p className="mb-6 mt-2 text-sm text-brand-ink-muted">
          Tell us what you need once and get quotes from the restaurants you pick
          {config ? ` (up to ${config.max_restaurants})` : ""}.
        </p>
        {config ? (
          <CateringRequestWizard config={config} initialRestaurant={initialRestaurant} />
        ) : (
          <InfoPanel title="Couldn't load the form" body={loadError ?? "Please try again."} />
        )}
      </section>
    </main>
  );
}
