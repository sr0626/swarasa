// ONE shared US phone rule for every phone input on the platform. Pure — no
// I/O — so it's trivially unit-testable (lib/phone.test.ts).
//
// Keep this in lock-step with backend/app/core/phone.py `normalize_us_phone`:
// both are tested against the SAME case table (tests/unit/test_phone_
// normalization.py and lib/phone.test.ts), so a number one layer accepts the
// other accepts too, and both produce the same stored value.
//
// The rule (docs/DECISIONS.md "US phone validation"):
//   - accepted formatting: digits plus spaces, dashes, dots and parentheses,
//     with an optional single leading `+1` or bare leading `1` country code;
//   - after stripping formatting and a leading country code, EXACTLY 10
//     digits must remain (an 11-digit number that doesn't start with the `1`
//     country code is rejected);
//   - the area code and the exchange must each start with 2-9 (NANP);
//   - anything else — letters, extensions, other country codes, a `+`
//     anywhere but the front — is rejected.
//
// Stored/canonical form: E.164, `+1XXXXXXXXXX` (12 chars). That is what
// `POST/PATCH /locations` and `PATCH /auth/me` store and what the display
// formatter (lib/formatPhone.ts, `+19725550142` -> `(972) 555-0142`)
// expects, so existing rows are unaffected; legacy rows that don't fit are
// left alone (no backfill).

/** The one inline message shown for a bad phone, everywhere (also the API's). */
export const US_PHONE_ERROR = "Enter a valid 10-digit US phone number";

/** Returns `+1XXXXXXXXXX`, or `null` when `input` isn't a valid US phone number. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  // Only these characters may appear; a `+` only as the very first character.
  if (!trimmed || !/^\+?[0-9 \t().-]+$/.test(trimmed)) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");

  let national: string;
  if (hasPlus) {
    // "+" is only meaningful as the +1 country code.
    if (digits.length !== 11 || !digits.startsWith("1")) return null;
    national = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  return isNanp(national) ? `+1${national}` : null;
}

/**
 * Inline message for a phone field, or `null` when the value is fine. Blank
 * reads "Phone number is required"; anything else that fails the rule reads
 * `US_PHONE_ERROR`. For plain (non-zod) forms — the zod schemas in
 * lib/validation/phone.ts produce the same messages.
 */
export function phoneFieldError(input: string): string | null {
  if (!input.trim()) return "Phone number is required";
  return normalizePhone(input) ? null : US_PHONE_ERROR;
}

/** North American Numbering Plan: area code and exchange both start with 2-9. */
function isNanp(tenDigits: string): boolean {
  return /^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(tenDigits);
}
