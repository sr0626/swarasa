// Unclaimed-listing call-to-action, shown prominently at the top of the
// public restaurant page's sidebar. `restaurant_brand.owner_id` is null /
// `is_claimed` is false for admin-seeded or CSV-imported listings nobody has
// claimed yet (docs/DECISIONS.md "owner_id nullable on restaurant_brand
// (unclaimed listings)").
//
// The link goes to the real claim flow (`/claim?brand_id=`, app/claim). That
// page requires a session, and a signed-out visitor is bounced to sign in
// with a `next` return path (lib/auth/safeNext.ts), so this is never a dead
// end -- the copy below tells them what to expect up front.
import Link from "next/link";

export default function ClaimCTA({ brandId }: { brandId: number }) {
  return (
    <section
      aria-labelledby="claim-cta-heading"
      className="rounded-brand-card border-2 border-brand-accent bg-white p-5 shadow-brand-card"
    >
      <h2 id="claim-cta-heading" className="font-display text-lg font-bold text-brand-ink">
        Is this your restaurant?
      </h2>
      <p className="mt-1 text-sm text-brand-ink-muted">
        This listing hasn&apos;t been claimed yet. Claim it to manage hours,
        photos, and more.
      </p>
      <Link
        href={`/claim?brand_id=${brandId}`}
        className="mt-4 flex min-h-[44px] w-full items-center justify-center whitespace-nowrap rounded-brand-pill bg-brand-accent px-5 text-sm font-semibold text-white transition hover:bg-brand-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2"
      >
        Claim this restaurant
      </Link>
      <p className="mt-2 text-xs text-brand-ink-muted">
        You&apos;ll sign in or create a free owner account, then submit proof
        of ownership for review.
      </p>
    </section>
  );
}
