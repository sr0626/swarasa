// Restaurant-side quote amount parsing. Pure. Works on the typed string with
// integer math only (never floats), so "450.10" is exactly 45010 cents.
// Server rule: 0 < amount <= 1,000,000 dollars, at most 2 decimals.

const MAX_CENTS = 1_000_000 * 100;

export type QuoteAmountResult =
  | { ok: true; cents: number; /** normalised dollars string for the API, e.g. "450.50" */ amount: string }
  | { ok: false; error: string };

export function parseQuoteAmount(input: string): QuoteAmountResult {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (cleaned === "") return { ok: false, error: "Enter your quote amount in dollars." };
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { ok: false, error: "Enter a dollar amount like 450 or 450.50." };
  const whole = (match[1] ?? "").replace(/^0+(?=\d)/, "");
  const frac = (match[2] ?? "").padEnd(2, "0");
  if (whole.length > 7) return { ok: false, error: "The most you can quote is $1,000,000." };
  const cents = Number(whole) * 100 + Number(frac);
  if (cents <= 0) return { ok: false, error: "The quote must be more than $0." };
  if (cents > MAX_CENTS) return { ok: false, error: "The most you can quote is $1,000,000." };
  return { ok: true, cents, amount: `${whole}.${frac}` };
}

/** 45050 -> "450.50" for pre-filling the edit field. */
export function centsToInput(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export const QUOTE_NOTE_MAX = 2000;
