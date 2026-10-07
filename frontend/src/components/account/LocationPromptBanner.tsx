// Server half of the "add your city and ZIP" nudge for the home/search pages.
// Renders nothing for signed-out visitors and for every role except
// registered_user, and nothing once the diner has saved both fields. Any
// failure fetching /auth/me also renders nothing -- this is an enhancement
// and must never break (or block) browsing. Wrap in <Suspense fallback={null}>
// so the page itself never waits on it.
import LocationPromptBannerView from "@/components/account/LocationPromptBannerView";
import { getCurrentUser } from "@/lib/api/auth";
import { getServerSession } from "@/lib/auth/session";
import { hasLocation } from "@/lib/validation/userLocation";

export default async function LocationPromptBanner() {
  const session = await getServerSession();
  if (!session || session.role !== "registered_user") return null;

  try {
    const me = await getCurrentUser(session.accessToken);
    if (hasLocation(me)) return null;
  } catch {
    return null;
  }
  return <LocationPromptBannerView />;
}
