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
import { getCuisineTags } from "@/lib/api/cuisine";
import { getLocationById, getLocationManagers } from "@/lib/api/locations";
import { getLocationDeals } from "@/lib/api/deals";
import { getLocationMenuForManagement } from "@/lib/api/menu";
import LocationInfoForm from "@/components/portal/LocationInfoForm";
import LocationAboutForm from "@/components/portal/LocationAboutForm";
import LocationCuisineTagsForm from "@/components/portal/LocationCuisineTagsForm";
import LocationHoursEditor from "@/components/portal/LocationHoursEditor";
import LocationDealsManager from "@/components/portal/LocationDealsManager";
import LocationMenuManager from "@/components/portal/LocationMenuManager";
import LocationPhotoManager from "@/components/portal/LocationPhotoManager";
import LocationManagerAssignment from "@/components/portal/LocationManagerAssignment";
import GoLiveBar from "@/components/portal/GoLiveBar";
import ListingLiveNotice, { parseLiveParam } from "@/components/portal/ListingLiveNotice";
import ListingSetupBanner from "@/components/portal/ListingSetupBanner";
import LocationStatusMenu from "@/components/portal/LocationStatusMenu";
import EditorSectionNav from "@/components/portal/EditorSectionNav";
import { SECTION_ANCHOR_CLASS } from "@/components/portal/editorSectionAnchor";
import { editorSectionsForRole, type EditorSection } from "@/lib/portal/editorSections";
import NewListingNotice, { parseNewListingParam } from "@/components/portal/NewListingNotice";
import InfoPanel from "@/components/ui/InfoPanel";
import type { CuisineTag } from "@/types/cuisine";
import type { Deal } from "@/types/deal";
import type { LocationDetail, LocationManager } from "@/types/location";
import type { MenuResponse } from "@/types/menu";

export const metadata: Metadata = {
  title: "Edit Location",
};

interface LocationPageProps {
  params: { id: string };
  searchParams?: { new?: string | string[]; live?: string | string[] };
}

/** Where "back" goes depends on the role: an owner's home is their single
 * business page (/account), a manager's is their manager console (also
 * /account -- /portal/dashboard is only a redirect there, for both roles,
 * since the manager console redesign), and an admin (who would be bounced
 * to /login from /account) goes back to the admin listings panel. */
function backTarget(role: string): { href: string; label: string; short: string } {
  switch (role) {
    case "admin":
      return { href: "/admin/listings", label: "Back to listings", short: "Listings" };
    case "owner":
      return { href: "/account", label: "Back to your business account", short: "Business account" };
    default:
      return { href: "/account", label: "Back to your locations", short: "Locations" };
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
  let dealsHidden = false;
  try {
    const dealList = await getLocationDeals(locationId, session.accessToken);
    deals = dealList.results;
    dealsHidden = dealList.deals_hidden === true;
  } catch {
    deals = null;
  }

  // Menu (groups + items). Same access rule and same fail-safe as deals: a
  // load failure shows an error panel, never an empty editor an owner could
  // mistake for "no menu yet" (and re-enter everything).
  let menu: MenuResponse | null = null;
  try {
    menu = await getLocationMenuForManagement(locationId, session.accessToken);
  } catch {
    menu = null;
  }

  // The tag taxonomy for this location's "Cuisine & dietary tags" panel. A load failure
  // shows the panel's own "try again" note rather than hiding the section.
  let allTags: CuisineTag[] = [];
  try {
    allTags = await getCuisineTags();
  } catch {
    allTags = [];
  }

  const isOwner = session.role === "owner";
  const isAdmin = session.role === "admin";
  const back = backTarget(session.role);
  // Owners and admins create listings (Add restaurant / Add location); ignore
  // the flag for anyone else.
  const newListing = isOwner || isAdmin ? parseNewListingParam(searchParams?.new) : null;
  // `?live=1` is set by the Activate button right after a successful go-live.
  const justActivated =
    (isOwner || isAdmin) && location.status === "active" && parseLiveParam(searchParams?.live);

  // Each panel, keyed by section id. Order and visibility come from
  // editorSectionsForRole (Deals, Hours, Menu, Photos, About, Tags, Info, then the
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
      <LocationDealsManager
        locationId={location.id}
        initialDeals={deals}
        initialDealsHidden={dealsHidden}
      />
    ) : (
      anchored(
        sectionById("deals"),
        <InfoPanel
          title="Deals couldn't be loaded"
          body="We couldn't load this location's deals right now. Refresh the page to try again."
        />
      )
    ),
    hours: anchored(
      sectionById("hours"),
      <LocationHoursEditor
        locationId={location.id}
        hours={location.hours}
        status={location.status}
        setupMissing={location.setup_missing}
        role={session.role}
      />
    ),
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
    tags: anchored(
      sectionById("tags"),
      <LocationCuisineTagsForm
        locationId={location.id}
        allTags={allTags}
        initialTags={location.cuisine_tags}
      />
    ),
    info: anchored(sectionById("info"), <LocationInfoForm location={location} role={session.role} />),
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
        {/* The "Back to ..." link lives in the sticky bar (EditorSectionNav),
            so it stays reachable while scrolling. */}
        <EditorSectionNav
          sections={sections}
          backHref={back.href}
          backLabel={back.label}
          backShortLabel={back.short}
        />
        {/* Sticky "Go live" bar (only while the listing is in setup): what's
            left + the Activate button, always in view under the nav above. */}
        <GoLiveBar
          locationId={location.id}
          status={location.status}
          setupMissing={location.setup_missing}
          role={session.role}
        />
        {/* Heading row: the name, with the listing-status label right next to
            it. For owner/admin the label is a small menu holding the status
            actions (change status, request reopen, permanently remove) that
            used to live in a separate "Listing status" panel; a manager sees a
            plain label. The chip is a sibling of the <h1>, not inside it, so
            the heading text stays just the name. */}
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            {location.brand_name}
            {location.location_name ? ` — ${location.location_name}` : ""}
          </h1>
          <LocationStatusMenu
            locationId={location.id}
            initialStatus={location.status}
            role={session.role}
            backHref={back.href}
            setupMissing={location.setup_missing}
          />
        </div>
        <p className="mt-1 text-sm text-brand-ink-muted">
          {location.address_line1}, {location.city}, {location.state} {location.postal_code}
        </p>
        {newListing && location.status === "coming_soon" && <NewListingNotice mapPosition={newListing} />}
        {justActivated && (
          <ListingLiveNotice brandSlug={location.brand_slug} locationSlug={location.slug} />
        )}
        {/* A listing in setup (coming_soon, right after Add restaurant/Add
            location) says it's not live and shows the readable checklist; the
            Activate button is in the sticky Go-live bar under the nav. */}
        <ListingSetupBanner
          status={location.status}
          setupMissing={location.setup_missing}
          role={session.role}
        />

        <div className="mt-6 flex flex-col gap-6">
          {sections.map((section) => (
            <Fragment key={section.id}>{panels[section.id]}</Fragment>
          ))}
        </div>
      </section>
    </main>
  );
}
