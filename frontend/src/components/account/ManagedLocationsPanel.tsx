// manager's assigned locations — GET /auth/me/managed-locations
// (docs/API_CONTRACTS.md, added alongside PR #78 to close the manager
// location-discovery gap). Task-focused: each row leads with the location and
// its open status, with prominent Edit and Menu actions (the routes a manager
// actually works in: /portal/locations/{id} and /portal/locations/{id}/menu).
//
// No "View public page" action: ManagedLocation carries neither the brand
// slug nor brand id the public /restaurant/[slug] route needs (flagged in
// the PR — would need the contract to expose the slug).
//
// Assignment is owner-controlled, so the empty state and footnote say so.
// Server Component — links only.
import Link from "next/link";
import { LocationPinIcon, PencilIcon } from "@/components/ui/icons";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import {
  cardClass,
  primaryLinkClass,
  secondaryLinkClass,
} from "@/components/account/accountShared";
import type { ManagedLocation } from "@/types/location";

export default function ManagedLocationsPanel({
  locations,
  loadError,
}: {
  locations: ManagedLocation[];
  loadError: string | null;
}) {
  return (
    <section aria-labelledby="managed-locations-heading" className={cardClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="managed-locations-heading"
          className="font-display text-xl font-bold text-brand-ink"
        >
          Locations I manage
        </h2>
        {!loadError && locations.length > 0 && (
          <span className="text-sm text-brand-ink-subtle">
            {locations.length} location{locations.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loadError && (
        <p
          role="alert"
          className="mt-4 rounded-brand-control bg-brand-closed-bg px-3 py-2.5 text-sm text-brand-closed"
        >
          {loadError}
        </p>
      )}

      {!loadError && locations.length === 0 && (
        <div className="mt-4 rounded-brand-card border border-dashed border-brand-border px-6 py-10 text-center">
          <p className="font-display text-base font-semibold text-brand-ink">
            No locations assigned yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-brand-ink-muted">
            Ask the restaurant owner to assign you to a location — it will show up here once they
            do.
          </p>
        </div>
      )}

      {!loadError && locations.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3">
          {locations.map((location) => {
            const label = location.location_name ?? location.address_line1;
            return (
              <li
                key={location.id}
                className="flex flex-col gap-3 rounded-brand-control border border-brand-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex items-start gap-2 text-sm font-semibold text-brand-ink">
                    <LocationPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink-subtle" />
                    <span className="break-words">
                      {location.location_name ? `${location.location_name} — ` : ""}
                      {location.address_line1}, {location.city}, {location.state}
                    </span>
                  </p>
                  <div className="mt-2 pl-6">
                    <OpenStatusBadge isOpenNow={location.is_open_now} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/portal/locations/${location.id}`}
                    aria-label={`Edit ${label}`}
                    className={primaryLinkClass}
                  >
                    <PencilIcon className="h-4 w-4" />
                    Edit
                  </Link>
                  <Link
                    href={`/portal/locations/${location.id}/menu`}
                    aria-label={`Menu for ${label}`}
                    className={secondaryLinkClass}
                  >
                    Menu
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 rounded-brand-control bg-brand-bg px-3 py-2.5 text-sm text-brand-ink-muted">
        The restaurant owner controls which locations you manage. Need access to another one? Ask
        the owner to assign you.
      </p>
    </section>
  );
}
