// Shared stroke-based SVG icons — "Spice Market" direction calls for inline
// SVG (never emoji) for search, location, and star-rating glyphs, all drawn
// at the same visual weight (round caps/joins, 1.75 stroke on a 24x24 grid).
// Color always comes from the caller's `className` (e.g. `text-brand-ink`,
// `text-brand-accent`) via `currentColor` — never a hardcoded fill/stroke.
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function SearchIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.5-4.5" />
    </svg>
  );
}

export function LocationPinIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 21s-7-6.29-7-11.5A7 7 0 0 1 19 9.5C19 14.71 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.25" />
    </svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <svg {...baseProps} strokeLinejoin="round" fill="currentColor" stroke="none" {...props}>
      <path d="M12 3.5l2.47 5.13 5.53.82-4 4.02.94 5.53L12 16.6l-4.94 2.4.94-5.53-4-4.02 5.53-.82L12 3.5z" />
    </svg>
  );
}

/** Added for the restaurant detail page's weekly hours section. */
export function ClockIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.25V12l3.25 2" />
    </svg>
  );
}

/** Added for the restaurant detail page's contact/phone line. */
export function PhoneIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

/** Added for the restaurant detail page's photo gallery section. */
export function ImageIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M3.5 16l5-5 4 4 3-3 4.5 4.5" />
    </svg>
  );
}

/** Added for the claim submission form's document-upload proof method. */
export function UploadIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 15.5V4.5" />
      <path d="M8 8.5l4-4 4 4" />
      <path d="M4.5 15.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" />
    </svg>
  );
}

/** Added for the admin claims queue's approve action. */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** Added for the admin claims queue's reject action. */
export function XIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Added for the claim submission form's pending-review success state. */
export function ClipboardCheckIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5" />
      <path d="M9 13l2 2 4-4.5" />
    </svg>
  );
}

/** Added for the admin account page's "Reports" quick action. */
export function FlagIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h11l-2 4 2 4h-11" />
    </svg>
  );
}

/** Added for the owner portal's info-edit sections (location editor). */
export function PencilIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M15.5 4.5l4 4L8 20l-4.5 1L4.5 16.5 15.5 4.5z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** Added for the owner portal's photo/manager removal actions. */
export function TrashIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4.5 7h15" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
      <path d="M6.5 7l1 12a2 2 0 0 0 2 1.9h5a2 2 0 0 0 2-1.9l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** Added for the owner portal's "add photo" / "add manager" actions. */
export function PlusIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Added for the location editor's manager assignment section. */
export function UsersIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.6-3 2.7-5 5.5-5s4.9 2 5.5 5" />
      <circle cx="17" cy="8.5" r="2.5" />
      <path d="M15.5 14c1.8.6 3.1 2.2 3.9 4.5" />
    </svg>
  );
}

/** Single-person glyph, added for the admin console sidebar's Profile item. */
export function UserIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.8-3.6 3.7-5.5 7-5.5s6.2 1.9 7 5.5" />
    </svg>
  );
}

/** Added for the account page's "Download my data" CCPA export action. */
export function DownloadIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 4v11" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4.5 16v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/** Added for the header account dropdown's trigger (open/closed affordance). */
export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
}

/** Added for the /search "Filters" dropdown trigger (sliders glyph). */
export function FilterIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

/** Added for the owner portal dashboard's brand cards. */
export function StoreIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M4 9.5l1-5h14l1 5" />
      <path d="M4.5 9.5a2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0 2.25 2.25 0 0 0 4.5 0" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </svg>
  );
}

/**
 * Added for the show/hide password reveal toggle (docs/PROJECT_PLAN.csv
 * "Show/hide password toggle (eye icon) on all password fields") — used by
 * PasswordInput.tsx. Decorative only (aria-hidden via baseProps); the
 * toggle button itself carries the accessible "Show password"/"Hide
 * password" label.
 */
export function EyeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Eye-with-slash counterpart to EyeIcon, shown when the password is visible. */
export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M6.6 6.6C4 8.4 2.5 12 2.5 12s3.5 7 9.5 7c1.4 0 2.7-.3 3.9-.9" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6 0 9.5 7 9.5 7a13.5 13.5 0 0 1-3.1 4.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  );
}

/**
 * Coffee cup on a saucer with two steam wisps. Drawn on the same 24px grid
 * as the icons above, but also used large as the search tile's default
 * (no-cover-photo) image — at that size pass a thinner `strokeWidth`
 * (e.g. 0.7) so the line weight stays delicate instead of scaling up 5x.
 */
export function CoffeeCupIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      {/* steam */}
      <path d="M10 2.25c-1.25 1.3 1.25 2.2 0 4" />
      <path d="M14 2.25c-1.25 1.3 1.25 2.2 0 4" />
      {/* cup body */}
      <path d="M6.5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9.5z" />
      {/* handle */}
      <path d="M17.5 11h1a2.75 2.75 0 0 1 0 5.5h-1.75" />
      {/* saucer */}
      <path d="M3.5 20.25h17c-.9 1.6-3.4 2.25-8.5 2.25s-7.6-.65-8.5-2.25z" />
    </svg>
  );
}

/** Added for the restaurant page info card's website link. */
export function GlobeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z" />
    </svg>
  );
}

/** Added for the restaurant page's "back to where you came from" link. */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  );
}

/** Added for the restaurant page info card's "Get directions" link. */
export function DirectionsIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12 12 3.5z" />
      <path d="M8.75 13.25v-2a1.5 1.5 0 0 1 1.5-1.5H15" />
      <path d="M13 8l2.25 1.75L13 11.5" />
    </svg>
  );
}

/**
 * Outline heart — "not followed" state of the follow/unfollow toggle on
 * restaurant tiles (RestaurantCard) and the detail page hero
 * (RestaurantHero), added for docs/PROJECT_PLAN.csv "Follow button in UI".
 * Shares its path with `HeartFilledIcon` below (outline vs. filled is the
 * only visual difference, same "similar to Facebook like/love" convention
 * as a typical like button) so the two states read as clearly the same
 * glyph, just toggled — same pairing pattern as `EyeIcon`/`EyeOffIcon`.
 */
export function HeartIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 20.25s-7.6-4.66-10.06-9.35C.36 7.7 2.2 4.24 5.77 3.72c2.16-.31 4.3.78 6.23 2.98 1.93-2.2 4.07-3.29 6.23-2.98 3.57.52 5.41 3.98 3.83 7.18C19.6 15.59 12 20.25 12 20.25z" />
    </svg>
  );
}

/**
 * Filled/solid counterpart to `HeartIcon` — the "followed" state, rendered
 * in the brand accent color by the caller's `className` (`currentColor`,
 * same convention as `StarIcon`) so it reads as distinctly different from
 * the outline state at a glance, not just a color shift.
 */
export function HeartFilledIcon(props: IconProps) {
  return (
    <svg {...baseProps} strokeLinejoin="round" fill="currentColor" stroke="none" {...props}>
      <path d="M12 20.25s-7.6-4.66-10.06-9.35C.36 7.7 2.2 4.24 5.77 3.72c2.16-.31 4.3.78 6.23 2.98 1.93-2.2 4.07-3.29 6.23-2.98 3.57.52 5.41 3.98 3.83 7.18C19.6 15.59 12 20.25 12 20.25z" />
    </svg>
  );
}
