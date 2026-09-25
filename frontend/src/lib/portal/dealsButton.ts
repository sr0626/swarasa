// State -> label / variant / accessible name for the "Deals" shortcut button on
// the owner business page location rows and the manager "Locations I manage"
// rows. Pure so it can be unit-tested (`npm run test:unit`); the styling lives
// in components/portal/DealsButton.tsx.
//
// Inputs come from the owner-scoped location lists only
// (`LocationSummary` / `ManagedLocation`: `active_deals_count`, `deals_hidden`).
// `active_deals_count` counts LIVE deals (active and not past their end date);
// `deals_hidden` is the location-level "Hide all deals" switch. Colour is never
// the only signal: every state has different label text.
export type DealsButtonVariant =
  /** >= 1 live deal, shown publicly: tinted accent. */
  | "live"
  /** No live deals: quiet outline nudging the owner to add one. */
  | "empty"
  /** "Hide all deals" is ON: grey, nothing shows publicly. */
  | "hidden"
  /** Count unknown (older backend / field missing): the plain "Deals" button. */
  | "neutral";

export interface DealsButtonState {
  variant: DealsButtonVariant;
  /** Visible text. */
  label: string;
  /** Full accessible name (the visible label is contained in it). */
  ariaLabel: string;
}

export function dealsButtonState(
  locationLabel: string,
  activeDealsCount: number | null | undefined,
  dealsHidden: boolean | null | undefined
): DealsButtonState {
  const count =
    typeof activeDealsCount === "number" && activeDealsCount >= 0
      ? Math.floor(activeDealsCount)
      : null;

  if (dealsHidden === true) {
    return {
      variant: "hidden",
      label: count ? `Deals hidden · ${count}` : "Deals hidden",
      ariaLabel: count
        ? `Deals for ${locationLabel}: hidden from the public, ${count} active`
        : `Deals for ${locationLabel}: hidden from the public`,
    };
  }
  if (count === null) {
    return { variant: "neutral", label: "Deals", ariaLabel: `Deals for ${locationLabel}` };
  }
  if (count === 0) {
    return {
      variant: "empty",
      label: "Add a deal",
      ariaLabel: `Add a deal for ${locationLabel}: none active`,
    };
  }
  return {
    variant: "live",
    label: `Deals · ${count}`,
    ariaLabel: `Deals for ${locationLabel}: ${count} active`,
  };
}
