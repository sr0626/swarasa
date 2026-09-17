// manager's assigned locations — GET /auth/me/managed-locations, the new
// endpoint added alongside PR #78 to close the manager location-discovery
// gap (docs/API_CONTRACTS.md "GET /auth/me/managed-locations"). Read-only
// list that links into each location's real editor. Server Component — no
// interactivity here.
import Link from "next/link";
import { LocationPinIcon, PencilIcon } from "@/components/ui/icons";
import InfoPanel from "@/components/ui/InfoPanel";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import type { ManagedLocation } from "@/types/location";

export default function ManagedLocationsList({
  locations,
  loadError,
}: {
  locations: ManagedLocation[];
  loadError: string | null;
}) {
  return (
    <section
      aria-labelledby="managed-locations-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card sm:p-6"
    >
      <h2
        id="managed-locations-heading"
        className="font-display text-xl font-bold text-brand-ink"
      >
        Locations you manage
      </h2>

      <div className="mt-4">
        {loadError && <InfoPanel title="Couldn't load your assigned locations" body={loadError} />}

        {!loadError && locations.length === 0 && (
          <InfoPanel
            title="No locations assigned yet"
            body="Ask the restaurant owner to assign you to a location — it will show up here once they do."
          />
        )}

        {!loadError && locations.length > 0 && (
          <ul className="flex flex-col gap-2">
            {locations.map((location) => (
              <li key={location.id}>
                <Link
                  href={`/portal/locations/${location.id}`}
                  className="flex min-h-[44px] items-center justify-between gap-3 rounded-brand-control border border-brand-border bg-white px-4 py-2.5 transition hover:border-brand-ink-subtle"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-brand-ink">
                    <LocationPinIcon className="h-4 w-4 shrink-0 text-brand-ink-subtle" />
                    <span className="truncate">
                      {location.location_name ? `${location.location_name} — ` : ""}
                      {location.address_line1}, {location.city}, {location.state}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <OpenStatusBadge isOpenNow={location.is_open_now} />
                    <PencilIcon className="h-4 w-4 text-brand-ink-subtle" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
