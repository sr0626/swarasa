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
