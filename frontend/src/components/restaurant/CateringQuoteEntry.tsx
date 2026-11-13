// "Get catering quotes" entry point on a location's public page. Server
// component. Shown ONLY when this location can receive catering requests
// (subscribed + opted in; the public eligibility probe), and then:
//   - signed-in registered user -> link into the request flow with this
//     restaurant pre-selected;
//   - signed-out visitor        -> the same card, pointing at sign-in (the
//     flow needs an account) and coming straight back to the flow;
//   - owner / manager / admin   -> nothing (they can't request quotes).
import Link from "next/link";
import { getCateringEligibility } from "@/lib/api/catering";
import { safeNextPath, withNext } from "@/lib/auth/safeNext";
import type { Session } from "@/types/auth";

export default async function CateringQuoteEntry({
  locationId,
  session,
}: {
  locationId: number;
  session: Session | null;
}) {
  if (session && session.role !== "registered_user") return null;
  const eligible = await getCateringEligibility(locationId);
  if (!eligible) return null;

  const flowPath = `/account/catering/new?location=${locationId}`;
  const href = session ? flowPath : withNext("/login", safeNextPath(flowPath));

  return (
    <section
      aria-labelledby="catering-entry-heading"
      className="rounded-brand-card border border-brand-border bg-white p-4 shadow-brand-card sm:p-5"
    >
      <h2 id="catering-entry-heading" className="font-display text-lg font-bold text-brand-ink">
        Catering for your event?
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        Tell us what you need and get a quote from this restaurant (and others) without calling around.
      </p>
      <Link
        href={href}
        className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-brand-control bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2"
      >
        {session ? "Get catering quotes" : "Sign in to get catering quotes"}
      </Link>
    </section>
  );
}
