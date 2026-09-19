// Display formatting for phone numbers. Pure — no I/O — so it's trivially
// unit-testable (lib/formatPhone.test.ts).
//
// Phones are STORED in E.164 (lib/phone.ts `normalizePhone`: US numbers are
// `+1XXXXXXXXXX`), which is right for `tel:` links but ugly as visible text.
// Use this for what people READ; keep the raw stored value for `href="tel:..."`.

/**
 * `+19725550142` -> `(972) 555-0142`. Only a `+1` followed by exactly ten
 * digits is reformatted; anything else (non-US country codes, legacy
 * free-text values, empty strings) is returned unchanged so we never mangle
 * a number we don't understand.
 */
export function formatPhone(phone: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone.trim());
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}
