// /account for a registered_user (diner): friendly and discovery-oriented.
// Warm hero header with a greeting and a "find restaurants" CTA; the main
// column is the visual grid of followed restaurants, the side column holds
// the account details, security link and privacy/data controls. No business
// terminology. Server Component (children handle their own interactivity).
import Link from "next/link";
import AccountAvatar from "@/components/account/AccountAvatar";
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import DisplayNameForm from "@/components/account/DisplayNameForm";
import FollowedRestaurantsGrid from "@/components/account/FollowedRestaurantsGrid";
import SecurityCard from "@/components/account/SecurityCard";
import { firstNameFor, primaryLinkClass } from "@/components/account/accountShared";
import { SearchIcon } from "@/components/ui/icons";
import type { AuthMe } from "@/types/auth";
import type { FollowedBrand } from "@/types/follow";
import type { DataDeletionRequest } from "@/types/privacy";

export default function DinerAccountView({
  me,
  follows,
  followsError,
  latestDeletionRequest,
}: {
  me: AuthMe;
  follows: FollowedBrand[];
  followsError: string | null;
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  const firstName = firstNameFor(me);
  const followCount = follows.length;

  return (
    <div className="flex flex-col gap-6">
      <header className="overflow-hidden rounded-brand-card border border-brand-border bg-white shadow-brand-card">
        <div aria-hidden="true" className="h-24 bg-brand-warm-gradient sm:h-28" />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
            <AccountAvatar me={me} className="-mt-10 sm:-mt-12" />
            <div className="min-w-0">
              <h1 className="break-words font-display text-2xl font-bold text-brand-ink sm:text-3xl">
                {firstName ? `Hi, ${firstName}` : "Welcome back"}
              </h1>
              <p className="mt-1 text-sm text-brand-ink-muted">
                {followsError
                  ? "Your favorite desi restaurants, all in one place."
                  : followCount === 0
                    ? "Follow your favorite desi restaurants to keep them close."
                    : `You follow ${followCount} restaurant${followCount === 1 ? "" : "s"}.`}
              </p>
            </div>
          </div>
          <Link href="/search" className={primaryLinkClass}>
            <SearchIcon className="h-4 w-4" />
            Find restaurants
          </Link>
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-x-10">
        <div className="min-w-0">
          <FollowedRestaurantsGrid follows={follows} loadError={followsError} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <DisplayNameForm initialFullName={me.full_name} />
          <AccountDetailsCard me={me} stacked nameEditableElsewhere />
          <SecurityCard />
          <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
        </div>
      </div>
    </div>
  );
}
