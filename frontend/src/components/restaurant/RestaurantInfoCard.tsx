// The restaurant page's one compact "info card" (right sidebar on lg+,
// directly under the hero on mobile): open/closed status, address as a
// Google Maps link with a "Get directions" link, phone, website, and the
// weekly hours. Replaces the old full-width Hours section, which took a
// whole page-width block for seven lines.
//
// Every row is conditional on real data -- nothing is fabricated or shown
// as an empty placeholder (phone/website are nullable; hours days can be
// unknown). Maps links use the same Google Maps URL pattern as
// components/listing/RestaurantCard.tsx (address search) plus the
// directions URL for the "Get directions" affordance.
import { DirectionsIcon, GlobeIcon, LocationPinIcon, PhoneIcon } from "@/components/ui/icons";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import RestaurantHours from "@/components/restaurant/RestaurantHours";
import { todayIndexInTimezone } from "@/lib/formatHours";
import type { LocationDetail } from "@/types/location";

/** http(s) only, so a bad/hostile stored value (e.g. `javascript:`) can
 * never become a clickable href. Returns the normalized href and a short
 * display label (hostname without a leading www.), or null to hide. */
function parseWebsite(raw: string | null): { href: string; label: string } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { href: url.toString(), label: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

const linkClass =
  "flex min-h-[44px] items-center gap-2.5 rounded-brand-control py-1 text-sm text-brand-ink-muted transition hover:text-brand-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

export default function RestaurantInfoCard({
  location,
  website,
}: {
  /** Null when the brand has no location yet -- then only the website (if any) can show. */
  location: LocationDetail | null;
  website: string | null;
}) {
  const site = parseWebsite(website);
  const hasHours = location?.hours.some((h) => h.is_closed !== null) ?? false;
  if (!location && !site) return null;

  const todayIndex = location ? todayIndexInTimezone(location.timezone) : null;
  const todayHour =
    location && todayIndex !== null
      ? location.hours.find((h) => h.day_of_week === todayIndex)
      : undefined;

  let fullAddress = "";
  let mapsSearchUrl = "";
  let mapsDirectionsUrl = "";
  if (location) {
    fullAddress = [
      location.address_line1,
      location.address_line2,
      `${location.city}, ${location.state} ${location.postal_code}`,
    ]
      .filter(Boolean)
      .join(", ");
    const query = encodeURIComponent(fullAddress);
    mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
    mapsDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${query}`;
  }

  return (
    <section
      aria-labelledby="info-card-heading"
      className="rounded-brand-card border border-brand-border bg-white p-5 shadow-brand-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="info-card-heading" className="font-display text-lg font-bold text-brand-ink">
          Details
        </h2>
        {location && (
          <OpenStatusBadge
            isOpenNow={location.is_open_now}
            isClosedToday={todayHour?.is_closed}
            openTime={todayHour?.open_time}
            closeTime={todayHour?.close_time}
          />
        )}
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {location && (
          <>
            <a
              href={mapsSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              <LocationPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {fullAddress}
                <span className="sr-only"> (opens in Google Maps in a new tab)</span>
              </span>
            </a>

            <a
              href={mapsDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex min-h-[44px] items-center justify-center gap-2 rounded-brand-pill border border-brand-ink px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-chip focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            >
              <DirectionsIcon className="h-4 w-4" />
              Get directions
              <span className="sr-only"> (opens in Google Maps in a new tab)</span>
            </a>

            {location.phone && (
              <a href={`tel:${location.phone}`} className={linkClass}>
                <PhoneIcon className="h-4 w-4 shrink-0" />
                {location.phone}
              </a>
            )}
          </>
        )}

        {site && (
          <a
            href={site.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            <GlobeIcon className="h-4 w-4 shrink-0" />
            <span className="break-all">
              {site.label}
              <span className="sr-only"> (website, opens in a new tab)</span>
            </span>
          </a>
        )}
      </div>

      {location && hasHours && (
        <div className="mt-4 border-t border-brand-border pt-4">
          <RestaurantHours hours={location.hours} todayIndex={todayIndex} />
        </div>
      )}
    </section>
  );
}
