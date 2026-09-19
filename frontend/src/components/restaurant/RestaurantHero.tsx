// Hero section for the public restaurant detail page: cover photo (or the
// homepage card's gradient placeholder when none exists), name, cuisine
// tags, open/closed status, and address/phone when a location exists.
import { LocationPinIcon, PhoneIcon } from "@/components/ui/icons";
import DefaultRestaurantImage from "@/components/ui/DefaultRestaurantImage";
import OpenStatusBadge from "@/components/ui/OpenStatusBadge";
import type { RestaurantBrand } from "@/types/restaurant";
import type { LocationDetail } from "@/types/location";

interface RestaurantHeroProps {
  restaurant: RestaurantBrand;
  /** Full location detail for the brand's primary location — null when the
   * brand has no locations yet (an unclaimed, address-less seed row). */
  location: LocationDetail | null;
}

export default function RestaurantHero({ restaurant, location }: RestaurantHeroProps) {
  return (
    <section>
      <div className="relative h-56 w-full overflow-hidden rounded-brand-card border border-brand-border bg-brand-warm-gradient sm:h-72">
        {location?.cover_photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote
          // CloudFront URL, no next/image domain config for this host yet.
          <img
            src={location.cover_photo_url}
            alt={`${restaurant.name} cover photo`}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <DefaultRestaurantImage />
        )}
        {location && (
          <div className="absolute right-3 top-3">
            <OpenStatusBadge isOpenNow={location.is_open_now} />
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          {restaurant.name}
        </h1>

        {restaurant.cuisine_tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {restaurant.cuisine_tags.map((tag) => (
              <span
                key={tag.name}
                className="rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-medium text-brand-chip-ink"
              >
                {tag.display_name}
              </span>
            ))}
          </div>
        )}

        {restaurant.description && (
          <p className="max-w-2xl text-sm text-brand-ink-muted">{restaurant.description}</p>
        )}

        {location && (
          <div className="flex flex-col gap-1.5 text-sm text-brand-ink-subtle sm:flex-row sm:items-center sm:gap-4">
            <span className="flex items-center gap-1.5">
              <LocationPinIcon className="h-4 w-4 shrink-0" />
              {location.address_line1}
              {location.address_line2 ? `, ${location.address_line2}` : ""}, {location.city}, {location.state}{" "}
              {location.postal_code}
            </span>
            {location.phone && (
              <a href={`tel:${location.phone}`} className="flex items-center gap-1.5 hover:text-brand-ink hover:underline">
                <PhoneIcon className="h-4 w-4 shrink-0" />
                {location.phone}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
