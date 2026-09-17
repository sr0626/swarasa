// Site-wide contact email, used by the Contact Us page and the footer.
//
// JUDGMENT CALL (flagged in final report): no contact email, phone, or
// mailing address is decided anywhere in the repo — checked
// docs/BRD_v36_Restaurant_Platform.docx (no company contact details in the
// document at all) and docs/DECISIONS.md (only the production *domain* is
// discussed, and it isn't finalized either — see lib/site.ts). Rather than
// inventing a company identity detail and presenting it as real, this
// follows the exact same pattern lib/site.ts already uses for the equally
// undecided production domain: read from an env var first, fall back to a
// clearly-provisional placeholder derived from the same undecided domain,
// so local/preview builds still render a well-formed page instead of
// throwing or shipping a fabricated brand fact silently. Set
// NEXT_PUBLIC_CONTACT_EMAIL once a real inbox exists.
import { SITE_URL } from "@/lib/site";

function fallbackDomain(): string {
  try {
    return new URL(SITE_URL).hostname.replace(/^www\./, "");
  } catch {
    return "swarasa.com";
  }
}

export const CONTACT_EMAIL: string =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? `hello@${fallbackDomain()}`;
