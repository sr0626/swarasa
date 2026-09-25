"use client";

// Scrolling photo carousel for the restaurant page hero. No dependency:
// a native CSS scroll-snap track (so touch swipe, trackpad and mouse-wheel
// scrolling all work for free), plus prev/next buttons, dot indicators and
// arrow-key support layered on top. Follows the WAI-ARIA carousel pattern
// (aria-roledescription="carousel", per-slide "n of N" labels, a polite
// live region announcing the current photo).
//
// Only rendered for 2+ photos -- RestaurantHero shows a plain image for one
// and the shared default image for none, so a lone photo never gets
// pointless controls. The first slide loads eagerly (it is the LCP image);
// the rest are lazy.
//
// Touch-target note: the prev/next buttons are 44px. The dot indicators keep
// their compact look (a 24px-tall pill) but each has a 44px-tall tap area (a
// ::before pseudo-element extending above/below the pill, so the photo isn't
// covered by a taller strip) and is 32px wide (44px from `sm`): a paid listing
// can have 10 photos and 10 x 44px would not fit a 343px phone.
import { useCallback, useRef, useState, type KeyboardEvent } from "react";

export interface CarouselPhoto {
  url: string;
  alt: string;
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

const arrowButtonClass =
  "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-brand-ink shadow-brand-control transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";

export default function RestaurantPhotoCarousel({
  photos,
  label,
}: {
  photos: CarouselPhoto[];
  /** Accessible name for the whole carousel, e.g. "Bombay Sweets photos". */
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = photos.length;

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      const wrapped = (index + count) % count;
      // Smoothness comes from `motion-safe:scroll-smooth` on the track, so
      // prefers-reduced-motion users get an instant jump.
      track.scrollTo({ left: wrapped * track.clientWidth });
      setActive(wrapped);
    },
    [count],
  );

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    setActive((current) => (current === index ? current : Math.min(Math.max(index, 0), count - 1)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(active + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(active - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(count - 1);
    }
  }

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      className="relative overflow-hidden rounded-brand-card border border-brand-border bg-brand-chip"
    >
      <div
        ref={trackRef}
        role="region"
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        aria-label={`${label} — use left and right arrow keys to browse`}
        className="flex snap-x snap-mandatory overflow-x-auto motion-safe:scroll-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-accent [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((photo, index) => (
          <div
            key={photo.url}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}`}
            className="aspect-[4/3] w-full shrink-0 snap-center sm:aspect-[16/9]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- remote
                CloudFront URLs; no next/image domain config for this host
                yet (same as the rest of the restaurant components). */}
            <img
              src={photo.url}
              alt={photo.alt}
              loading={index === 0 ? "eager" : "lazy"}
              draggable={false}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => goTo(active - 1)}
        aria-label="Previous photo"
        className={`${arrowButtonClass} left-3`}
      >
        <ArrowIcon direction="left" />
      </button>
      <button
        type="button"
        onClick={() => goTo(active + 1)}
        aria-label="Next photo"
        className={`${arrowButtonClass} right-3`}
      >
        <ArrowIcon direction="right" />
      </button>

      <div className="absolute inset-x-0 bottom-2 flex justify-center">
        <div className="flex items-center rounded-brand-pill bg-brand-ink/60 px-1">
          {photos.map((photo, index) => (
            <button
              key={photo.url}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Go to photo ${index + 1}`}
              aria-current={index === active ? "true" : undefined}
              className="relative flex h-6 w-8 items-center justify-center rounded-full before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-11"
            >
              <span
                className={`block rounded-full transition-all ${
                  index === active ? "h-2 w-2 bg-white" : "h-1.5 w-1.5 bg-white/60"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        Photo {active + 1} of {count}
      </p>
    </div>
  );
}
