// Owner/manager/admin location editor — auth-gated. Phase 1 scope: edit listing
// details, hours, and photos (frontend/CLAUDE.md), plus manager assignment
// (owner-only, docs/API_CONTRACTS.md "Location Managers").
//
// Access check (task requirement: "surface a real 'not found or no access'
// state, don't leak whether the location exists to someone without
// rights"): `GET /locations/{id}` is public, so its 404 is a genuine
// "doesn't exist." `GET /locations/{id}/managers` is exactly the
// owner-owns-brand-or-active-manager check this page needs (docs/
// API_CONTRACTS.md), so it doubles as the access gate — a 403 there
// renders the *same* generic panel as a 404 does, so an unauthorized
// caller can't distinguish "doesn't exist" from "exists but not yours."
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import { getLocationById, getLocationManagers } from "@/lib/api/locations";
import LocationInfoForm from "@/components/portal/LocationInfoForm";
import LocationAboutForm from "@/components/portal/LocationAboutForm";
import LocationHoursEditor from "@/components/portal/LocationHoursEditor";
import LocationPhotoManager from "@/components/portal/LocationPhotoManager";
import LocationManagerAssignment from "@/components/portal/LocationManagerAssignment";
import NewListingNotice, { parseNewListingParam } from "@/components/portal/NewListingNotice";
import InfoPanel from "@/components/ui/InfoPanel";
import type { LocationDetail, LocationManager } from "@/types/location";

export const metadata: Metadata = {
  title: "Edit Location",
};

interface LocationPageProps {
  params: { id: string };
  searchParams?: { new?: string | string[] };
}

/** Where "back" goes depends on the role: an owner's home is their single
 * business page (/account -- /portal/dashboard only redirects owners there),
 * a manager still uses /portal/dashboard, and an admin (who would be bounced
 * to /login from the portal dashboard) goes back to the admin listings panel. */
function backTarget(role: string): { href: string; label: string } {
  switch (role) {
    case "admin":
      return { href: "/admin/listings", label: "Back to listings" };
    case "owner":
      return { href: "/account", label: "Back to your business account" };
    default:
      return { href: "/portal/dashboard", label: "Back to dashboard" };
  }
}

function NotFoundOrNoAccess({ role }: { role: string }) {
  const back = backTarget(role);
  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <InfoPanel
          title="Location not found"
          body="This location either doesn't exist or you don't have access to it."
        />
        <Link
          href={back.href}
          className="mt-6 inline-flex min-h-[44px] items-center rounded-brand-pill bg-brand-ink px-5 text-sm font-semibold text-brand-bg transition hover:bg-brand-ink/90"
        >
          {back.label}
        </Link>
      </section>
    </main>
  );
}

export default async function PortalLocationPage({ params, searchParams }: LocationPageProps) {
  const session = await requireSession(["owner", "manager", "admin"]);

  const locationId = Number.parseInt(params.id, 10);
  if (!Number.isInteger(locationId) || locationId <= 0 || String(locationId) !== params.id) {
    return <NotFoundOrNoAccess role={session.role} />;
  }

  let location: LocationDetail;
  try {
    location = await getLocationById(locationId);
  } catch {
    // Public endpoint — a thrown error here means the location genuinely
    // doesn't exist (or the API is unreachable, treated the same way
    // rather than a confusing partial page).
    return <NotFoundOrNoAccess role={session.role} />;
  }

  let managers: LocationManager[] = [];
  try {
    const result = await getLocationManagers(locationId, {}, session.accessToken);
    managers = result.results;
  } catch {
    // 403 (no ownership/assignment) — same panel as a 404 above, so this
    // doesn't leak "it exists, you just can't see it" to an unauthorized
    // caller. Any other unexpected error is treated the same, conservatively.
    return <NotFoundOrNoAccess role={session.role} />;
  }

  const isOwner = session.role === "owner";
  const back = backTarget(session.role);
  // Only owners create listings; ignore the flag for anyone else.
  const newListing = isOwner ? parseNewListingParam(searchParams?.new) : null;

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link href={back.href} className="text-sm font-medium text-brand-ink-subtle hover:text-brand-ink">
          {back.label}
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
          {location.brand_name}
          {location.location_name ? ` — ${location.location_name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-brand-ink-muted">
          {location.address_line1}, {location.city}, {location.state} {location.postal_code}
        </p>
        {newListing && <NewListingNotice mapPosition={newListing} />}

        <div className="mt-6 flex flex-col gap-6">
          <LocationInfoForm location={location} />
          <LocationAboutForm locationId={location.id} about={location.about} specialties={location.specialties} />
          <LocationHoursEditor locationId={location.id} hours={location.hours} />
          <LocationPhotoManager
            locationId={location.id}
            isPaid={location.is_paid}
            initialCoverPhotoUrl={location.cover_photo_url}
            initialGalleryPhotos={location.gallery_photos}
          />
          {isOwner && (
            <LocationManagerAssignment
              locationId={location.id}
              isPaid={location.is_paid}
              initialManagers={managers}
            />
          )}
        </div>
      </section>
    </main>
  );
}
