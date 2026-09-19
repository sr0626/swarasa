// Hero for the public restaurant detail page: a photo carousel of the
// location's cover photo + gallery (so owners can show dish photos, not
// just one banner), then the name and cuisine tags.
//
// Photo count decides the rendering:
//   0 photos -> the shared coffee-cup default image on the warm gradient
//   1 photo  -> a plain image, no controls
//   2+       -> RestaurantPhotoCarousel (client component)
// `gallery_photos` already arrives pre-truncated by the backend to the
// location's tier limit (2 free / 10 paid, docs/DECISIONS.md "Photo
// gallery") -- this only merges and renders, it does not re-implement that
// gate.
//
// The open/closed status is deliberately NOT overlaid on the photo any more:
// the sidebar info card carries it (RestaurantInfoCard), so repeating it
// here would just be noise.
import DefaultRestaurantImage from "@/components/ui/DefaultRestaurantImage";
import RestaurantPhotoCarousel, {
  type CarouselPhoto,
} from "@/components/restaurant/RestaurantPhotoCarousel";
import type { RestaurantBrand } from "@/types/restaurant";
import type { LocationDetail } from "@/types/location";

interface RestaurantHeroProps {
  restaurant: RestaurantBrand;
  /** Full location detail for the brand's primary location — null when the
   * brand has no locations yet (an unclaimed, address-less seed row). */
  location: LocationDetail | null;
}

/** Cover first, then gallery in display order; a cover that is also a
 * gallery entry (same URL) is shown once. */
function collectPhotos(name: string, location: LocationDetail | null): CarouselPhoto[] {
  if (!location) return [];
  const urls: string[] = [];
  if (location.cover_photo_url) urls.push(location.cover_photo_url);
  [...location.gallery_photos]
    .sort((a, b) => a.display_order - b.display_order)
    .forEach((photo) => {
      if (!urls.includes(photo.url)) urls.push(photo.url);
    });
  return urls.map((url, index) => ({ url, alt: `${name} photo ${index + 1}` }));
}

export default function RestaurantHero({ restaurant, location }: RestaurantHeroProps) {
  const photos = collectPhotos(restaurant.name, location);

  return (
    <section aria-label={`${restaurant.name} photos and summary`}>
      {photos.length >= 2 ? (
        <RestaurantPhotoCarousel photos={photos} label={`${restaurant.name} photos`} />
      ) : (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-brand-card border border-brand-border bg-brand-warm-gradient sm:aspect-[16/9]">
          {photos.length === 1 && photos[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote
            // CloudFront URL, no next/image domain config for this host yet.
            <img
              src={photos[0].url}
              alt={photos[0].alt}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <DefaultRestaurantImage />
          )}
        </div>
      )}

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
      </div>
    </section>
  );
}
