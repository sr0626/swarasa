// Display formatting for phone numbers. Pure — no I/O — so it's trivially
// unit-testable (lib/formatPhone.test.ts).
//
// Phones are STORED in E.164 (lib/phone.ts `normalizePhone`: US numbers are
// `+1XXXXXXXXXX`), which is right for `tel:` links but ugly as visible text.
// Use this for what people READ; keep the raw stored value / `phoneHref` for
// `href="tel:..."`. Legacy rows (imported/seeded before normalisation) may
// hold a bare 10-digit ("4691231234") or 11-digit ("14691231234") value —
// those are shown formatted too.

/** Formatting characters that may surround the digits of a US number. */
const US_PHONE_SHAPE = /^\+?[0-9 ().-]+$/;

/**
 * `+19725550142` / `19725550142` / `9725550142` / `972-555-0142` ->
 * `(972) 555-0142`. Only a US number — exactly ten digits, optionally
 * preceded by a `1` country code (with or without a `+`) and any of
 * `space ( ) . -` formatting — is reformatted. Anything else (non-US country
 * codes, extensions, free text, empty strings) is returned unchanged so we
 * never mangle a number we don't understand. No NANP area/exchange check:
 * this is display-only, and legacy rows may not satisfy it.
 */
export function formatPhone(phone: string): string {
  const trimmed = phone.trim();
  if (!US_PHONE_SHAPE.test(trimmed)) return phone;
  // A "+" is only meaningful as the leading +1 country code.
  if (trimmed.lastIndexOf("+") > 0) return phone;
  const digits = trimmed.replace(/\D/g, "");
  let national: string;
  if (digits.length === 10 && !trimmed.startsWith("+")) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    national = digits.slice(1);
  } else {
    return phone;
  }
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * Value for an `href="tel:..."` link: the canonical E.164 (`+1XXXXXXXXXX`)
 * whenever the stored value is a recognisable US number (including legacy
 * bare 10/11-digit rows), otherwise the trimmed original. Never includes
 * formatting characters, so dialers get a clean number.
 */
export function phoneHref(phone: string): string {
  const trimmed = phone.trim();
  const formatted = formatPhone(trimmed);
  if (formatted === trimmed && !/^\(\d{3}\) \d{3}-\d{4}$/.test(trimmed)) return trimmed;
  const digits = formatted.replace(/\D/g, "");
  return `+1${digits}`;
}
