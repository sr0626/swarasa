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
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guards";
import TopBar from "@/components/home/TopBar";
import { getLocationById, getLocationManagers } from "@/lib/api/locations";
import { getLocationDeals } from "@/lib/api/deals";
import { getLocationMenu } from "@/lib/api/menu";
import LocationInfoForm from "@/components/portal/LocationInfoForm";
import LocationAboutForm from "@/components/portal/LocationAboutForm";
import LocationHoursEditor from "@/components/portal/LocationHoursEditor";
import LocationDealsManager from "@/components/portal/LocationDealsManager";
import LocationMenuManager from "@/components/portal/LocationMenuManager";
import LocationPhotoManager from "@/components/portal/LocationPhotoManager";
import LocationManagerAssignment from "@/components/portal/LocationManagerAssignment";
import LocationStatusMenu from "@/components/portal/LocationStatusMenu";
import EditorSectionNav from "@/components/portal/EditorSectionNav";
import { SECTION_ANCHOR_CLASS } from "@/components/portal/editorSectionAnchor";
import { editorSectionsForRole, type EditorSection } from "@/lib/portal/editorSections";
import NewListingNotice, { parseNewListingParam } from "@/components/portal/NewListingNotice";
import InfoPanel from "@/components/ui/InfoPanel";
import type { Deal } from "@/types/deal";
import type { LocationDetail, LocationManager } from "@/types/location";
import type { MenuResponse } from "@/types/menu";

export const metadata: Metadata = {
  title: "Edit Location",
};

interface LocationPageProps {
  params: { id: string };
  searchParams?: { new?: string | string[] };
}

/** Where "back" goes depends on the role: an owner's home is their single
 * business page (/account), a manager's is their manager console (also
 * /account -- /portal/dashboard is only a redirect there, for both roles,
 * since the manager console redesign), and an admin (who would be bounced
 * to /login from /account) goes back to the admin listings panel. */
function backTarget(role: string): { href: string; label: string } {
  switch (role) {
    case "admin":
      return { href: "/admin/listings", label: "Back to listings" };
    case "owner":
      return { href: "/account", label: "Back to your business account" };
    default:
      return { href: "/account", label: "Back to your locations" };
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
    // Pass the caller's access token: `GET /locations/{id}` is public by
    // default but caller-aware (docs/PROJECT_PLAN.csv "Location status
    // lifecycle") — a non-active location 404s for anyone without real
    // access. Without the token here, the owner/admin/assigned manager
    // viewing THEIR OWN hidden (owner_deactivated/coming_soon/
    // closed_pending_reopen) location would incorrectly hit the same 404
    // as the public.
    location = await getLocationById(locationId, session.accessToken);
  } catch {
    // A thrown error here means the location genuinely doesn't exist, or
    // this caller has no access to it (or the API is unreachable, treated
    // the same way rather than a confusing partial page) — never
    // distinguishable from outside, same posture as the 403 check below.
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

  // Deals management list (every deal, active or not). Same access rule as
  // hours/photos (owner / assigned manager / admin), already established by
  // the managers probe above. A failure here shows an error panel in place
  // of the editor rather than an empty list, so an owner never mistakes
  // "couldn't load" for "no deals" (and double-adds).
  let deals: Deal[] | null = null;
  try {
    deals = (await getLocationDeals(locationId, session.accessToken)).results;
  } catch {
    deals = null;
  }

  // Menu (groups + items). Same access rule and same fail-safe as deals: a
  // load failure shows an error panel, never an empty editor an owner could
  // mistake for "no menu yet" (and re-enter everything).
  let menu: MenuResponse | null = null;
  try {
    menu = await getLocationMenu(locationId, session.accessToken);
  } catch {
    menu = null;
  }

  const isOwner = session.role === "owner";
  const isAdmin = session.role === "admin";
  const back = backTarget(session.role);
  // Only owners create listings; ignore the flag for anyone else.
  const newListing = isOwner ? parseNewListingParam(searchParams?.new) : null;

  // Each panel, keyed by section id. Order and visibility come from
  // editorSectionsForRole (Deals, Hours, Menu, Photos, About, Info, then the
  // owner-only Managers), so the jump-link row and the page share one source.
  // Panels are independent forms with their own state -- nothing depends on
  // DOM order. `deals`/`menu` carry their own ids (also the /deals and /menu
  // redirect fragments); the rest get a wrapper with a `sec-` id. Load-failure
  // placeholders keep the id too, so the link still lands somewhere sensible.
  const anchored = (section: EditorSection, node: ReactNode) => (
    <div id={section.anchorId} className={SECTION_ANCHOR_CLASS}>
      {node}
    </div>
  );
  const sections = editorSectionsForRole(session.role);
  const sectionById = (id: EditorSection["id"]) => sections.find((x) => x.id === id) as EditorSection;
  const panels: Partial<Record<EditorSection["id"], ReactNode>> = {
    deals: deals ? (
      <LocationDealsManager locationId={location.id} initialDeals={deals} />
    ) : (
      anchored(
        sectionById("deals"),
        <InfoPanel
          title="Deals couldn't be loaded"
          body="We couldn't load this location's deals right now. Refresh the page to try again."
        />
      )
    ),
    hours: anchored(sectionById("hours"), <LocationHoursEditor locationId={location.id} hours={location.hours} />),
    menu: menu ? (
      <LocationMenuManager locationId={location.id} initialMenu={menu} />
    ) : (
      anchored(
        sectionById("menu"),
        <InfoPanel
          title="Menu couldn't be loaded"
          body="We couldn't load this location's menu right now. Refresh the page to try again."
        />
      )
    ),
    photos: anchored(
      sectionById("photos"),
      <LocationPhotoManager
        locationId={location.id}
        isPaid={location.is_paid}
        initialCoverPhotoUrl={location.cover_photo_url}
        initialGalleryPhotos={location.gallery_photos}
      />
    ),
    about: anchored(
      sectionById("about"),
      <LocationAboutForm locationId={location.id} about={location.about} specialties={location.specialties} />
    ),
    info: anchored(sectionById("info"), <LocationInfoForm location={location} />),
    managers: isOwner
      ? anchored(
          sectionById("managers"),
          <LocationManagerAssignment locationId={location.id} isPaid={location.is_paid} initialManagers={managers} />
        )
      : null,
  };

  return (
    <main className="min-h-screen bg-brand-bg">
      <TopBar />
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link href={back.href} className="text-sm font-medium text-brand-ink-subtle hover:text-brand-ink">
          {back.label}
        </Link>
        {/* Heading row: the name, with the listing-status label right next to
            it. For owner/admin the label is a small menu holding the status
            actions (change status, request reopen, permanently remove) that
            used to live in a separate "Listing status" panel; a manager sees a
            plain label. The chip is a sibling of the <h1>, not inside it, so
            the heading text stays just the name. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            {location.brand_name}
            {location.location_name ? ` — ${location.location_name}` : ""}
          </h1>
          <LocationStatusMenu
            locationId={location.id}
            initialStatus={location.status}
            role={session.role}
            backHref={back.href}
          />
        </div>
        <p className="mt-1 text-sm text-brand-ink-muted">
          {location.address_line1}, {location.city}, {location.state} {location.postal_code}
        </p>
        {newListing && <NewListingNotice mapPosition={newListing} />}

        <EditorSectionNav sections={sections} />

        <div className="mt-6 flex flex-col gap-6">
          {sections.map((section) => (
            <Fragment key={section.id}>{panels[section.id]}</Fragment>
          ))}
        </div>
      </section>
    </main>
  );
}
