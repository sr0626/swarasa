// /account for an owner: THE business page -- the owner's profile page is
// their dashboard (no separate /portal/dashboard any more). The dark
// "Business account" banner and the left menu (Business account with in-page
// links, Add a restaurant) come from components/portal/OwnerShell.tsx, which
// app/account/page.tsx wraps around this view. This component renders the
// right-hand panel, top to bottom: stat tiles, My restaurants (brand cards +
// "Add a restaurant"), business profile edit form (or read-only details when
// there is no owner record), security, and data export/delete. Section ids
// (#restaurants, #profile, #security, #privacy) back the in-page menu links
// (see OWNER_NAV_ITEMS in components/console/navItems.ts). Server Component.
import AccountDetailsCard from "@/components/account/AccountDetailsCard";
import DataPrivacySection from "@/components/account/DataPrivacySection";
import OwnerStatTiles from "@/components/account/OwnerStatTiles";
import ProfileEditForm from "@/components/account/ProfileEditForm";
import SecurityCard from "@/components/account/SecurityCard";
import OwnerRestaurantsSection from "@/components/portal/OwnerRestaurantsSection";
import type { BrandWithLocations } from "@/lib/owner/loadOwnerRestaurants";
import type { AuthMe } from "@/types/auth";
import type { DataDeletionRequest } from "@/types/privacy";

export default function OwnerAccountView({
  me,
  brands,
  restaurantsError,
  latestDeletionRequest,
}: {
  me: AuthMe;
  brands: BrandWithLocations[];
  restaurantsError: string | null;
  latestDeletionRequest: DataDeletionRequest | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      <OwnerStatTiles
        brands={brands.map(({ locations, locationsError }) => ({
          locations: locations.map((l) => l.location),
          locationsError,
        }))}
        loadFailed={restaurantsError !== null}
      />

      <OwnerRestaurantsSection brands={brands} loadError={restaurantsError} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
        <div id="profile" className="scroll-mt-24">
          {me.owner_account ? (
            <ProfileEditForm ownerAccount={me.owner_account} />
          ) : (
            <AccountDetailsCard me={me} />
          )}
        </div>
        <div id="security" className="scroll-mt-24">
          <SecurityCard />
        </div>
      </div>

      <div id="privacy" className="scroll-mt-24">
        <DataPrivacySection latestDeletionRequest={latestDeletionRequest} />
      </div>
    </div>
  );
}
