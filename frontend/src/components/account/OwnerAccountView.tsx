// /account for an owner: business-dashboard feel. Header with the primary
// "Add another restaurant" CTA, a row of stat tiles, then two columns — main
// (my restaurants with quick Edit / View public page actions, and the
// business profile edit form) and side (identity summary, security, data
// export/delete). DOM order is the mobile order: header, stats, summary,
// restaurants, profile, security, privacy; on lg the summary and the
// security/privacy pair stack in the side column via explicit grid placement.
import Link from "next/link";
import AccountSummaryCard from "@/components/account/AccountSummaryCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import OwnerRestaurantsPanel, {
  type OwnerBrandSummary,
} from "@/components/account/OwnerRestaurantsPanel";
import OwnerStatTiles from "@/components/account/OwnerStatTiles";
import ProfileEditForm from "@/components/account/ProfileEditForm";
import SecurityCard from "@/components/account/SecurityCard";
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import { primaryLinkClass } from "@/components/account/accountShared";
import { PlusIcon } from "@/components/ui/icons";
import type { AuthMe } from "@/types/auth";
import type { DataDeletionRequest } from "@/types/privacy";

export default function OwnerAccountView({
  me,
  brands,
  brandsError,
  latestDeletionRequest,
}: {
  me: AuthMe;
  brands: OwnerBrandSummary[];
  brandsError: string | null;
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent">
            Owner
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Business account
          </h1>
          <p className="mt-2 text-sm text-brand-ink-muted">
            Your restaurants, business profile and account settings.
          </p>
        </div>
        <Link href="/portal/brands/new" className={primaryLinkClass}>
          <PlusIcon className="h-4 w-4" />
          Add another restaurant
        </Link>
      </header>

      <OwnerStatTiles brands={brands} loadFailed={brandsError !== null} />

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-x-10">
        <aside
          aria-label="Account summary"
          className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-6"
        >
          <AccountSummaryCard me={me} />
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <OwnerRestaurantsPanel brands={brands} loadError={brandsError} />
          {me.owner_account ? (
            <ProfileEditForm ownerAccount={me.owner_account} />
          ) : (
            <AccountDetailsCard me={me} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
          <SecurityCard />
          <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
        </div>
      </div>
    </div>
  );
}
