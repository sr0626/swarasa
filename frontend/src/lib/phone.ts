// Phone normalisation shared by the "Add restaurant" flow and the location
// editor. Pure — no I/O — so it's trivially unit-testable.
//
// Storage convention: `restaurant_location.phone` is a free-text
// varchar(20). It's required (non-empty) on `POST /locations` as of
// 2026-09-22 (docs/PROJECT_PLAN.csv "Make location phone required"), same
// standing as `name`; existing NULL-phone rows (seeded/imported) are left
// alone -- the DB column itself stays nullable, see
// backend/app/schemas/location.py LocationCreate.phone's judgment-call
// note. `backend/app/schemas/location.py` now runs the exact same
// normalisation as this file (`normalize_phone` there is a line-for-line
// port of `normalizePhone` here — keep them in sync), so a number this
// function accepts is accepted server-side too, and the value is rendered
// into `tel:` links (RestaurantInfoCard, RestaurantCard). New writes are
// normalised to E.164: US numbers become `+1XXXXXXXXXX` (12 chars, fits
// varchar(20)); an explicit `+` international number is kept as
// `+<digits>`.

/** Returns the E.164 form of `input`, or `null` when it isn't a plausible number. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (hasPlus) {
    // Explicit country code. NANP (+1) numbers must be exactly 11 digits.
    if (digits.startsWith("1")) return isNanp(digits.slice(1)) ? `+${digits}` : null;
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  // No "+": treat as a US number, with or without a leading 1.
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return isNanp(national) ? `+1${national}` : null;
}

/** North American Numbering Plan: area code and exchange both start with 2-9. */
function isNanp(tenDigits: string): boolean {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(tenDigits);
}
