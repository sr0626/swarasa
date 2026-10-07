// Footer nav links, kept as plain data so the set is unit-testable.
// "/privacy" is the signed-in-only data export / deletion page; it is listed
// for everyone and sends signed-out visitors to sign in first.
export const FOOTER_LINKS = [
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
  { href: "/terms", label: "Terms & Privacy" },
  { href: "/privacy", label: "Your Data" },
] as const;
