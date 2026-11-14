// Single source of truth for the "why create a free account" copy, shared by the
// homepage sign-up popup (components/home/SignupPromptModal.tsx) and the public
// /benefits page (app/benefits/page.tsx) so the two can never drift apart.
//
// Pure data, no React / DOM imports, so it is unit-testable with `node --test`.
// Each benefit names its icon by key; components/home/BenefitIcon.tsx maps the
// key to the SVG component (icons are React, so they cannot live in this file).

export type BenefitIconKey = "bell" | "tag" | "heart" | "mail" | "pin";

export interface SignupBenefit {
  /** Stable, unique id (React key, tests). */
  id: string;
  title: string;
  detail: string;
  icon: BenefitIconKey;
}

export const SIGNUP_TITLE = "Get more from Swarasa";
export const SIGNUP_SUBTITLE = "Create a free account to unlock:";
export const SIGNUP_FOOTNOTE = "Free to join. No payment needed.";
export const SIGNUP_CTA_LABEL = "Create free account";
export const SIGNUP_CTA_HREF = "/signup";
export const SIGNIN_LABEL = "Sign in";
export const SIGNIN_HREF = "/login";

/** Public page that lists the benefits permanently. */
export const BENEFITS_PATH = "/benefits";

// Copy approved by the user. "favorites" (US spelling) matches the account
// menu's "My Favorites". The catering line says "several restaurants" rather
// than a number: the cap is an admin-configurable setting (default 5) that is
// only readable from the sign-in-only GET /catering/config.
// Every claim is checked against the real app: the bell is in-app only (no
// email or push), "Deals today" is the public search toggle (`deals_today=true`)
// and signed-out visitors only get the content-free "deal available" signal.
export const SIGNUP_BENEFITS: readonly SignupBenefit[] = [
  {
    // "Follow" and "favorite" are ONE feature: the heart on a restaurant is the
    // follow toggle, and the account page's "My Favorites" lists the follows.
    id: "follow-favorites",
    title: "Follow your favorite restaurants",
    detail: "Tap the heart to keep them one tap away in My Favorites.",
    icon: "heart",
  },
  {
    id: "deal-alerts",
    title: "Get notified about new deals",
    detail: "A bell alert the moment a restaurant you follow posts a new deal.",
    icon: "bell",
  },
  {
    id: "search-deals-today",
    title: "Search today's deals",
    detail:
      "Use the Deals today filter to see who has a deal running right now, and open every deal in full: titles, days and dates. Visitors only see that a deal is available.",
    icon: "tag",
  },
  {
    id: "catering-quotes",
    title: "Request catering quotes",
    detail: "Send one request to several restaurants and compare their quotes.",
    icon: "mail",
  },
  {
    id: "search-near-you",
    title: "Search near you automatically",
    detail: "Save your city and ZIP and we start there.",
    icon: "pin",
  },
];
