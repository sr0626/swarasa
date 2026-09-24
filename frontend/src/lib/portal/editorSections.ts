// Section list for the location editor's jump-links row
// (components/portal/EditorSectionNav.tsx), built from what the page
// ACTUALLY renders for the caller's role, so a link never points at a panel
// that isn't there (e.g. an assigned manager or an admin has no "Managers"
// panel -- it is owner-only, see /portal/locations/[id]/page.tsx).
//
// Order is by how often each section is used (user request 2026-09-24):
// Deals first, then Hours, then Menu, Photos, About, Info, Managers last.
// The page renders its panels in this same order (it maps over this list's
// ids), so the link row and the page can't drift apart.

export type EditorSectionId =
  | "deals"
  | "hours"
  | "menu"
  | "photos"
  | "about"
  | "info"
  | "managers";

export interface EditorSection {
  /** Element id of the panel (or its wrapper) the link jumps to. `deals` and
   * `menu` are the ids the /deals and /menu redirect pages already use as
   * URL fragments, so they must stay exactly these. The others are prefixed
   * (`sec-…`) because bare ids like `about` are already taken by form fields. */
  anchorId: string;
  id: EditorSectionId;
  label: string;
}

const ALL_SECTIONS: readonly EditorSection[] = [
  { id: "deals", anchorId: "deals", label: "Deals" },
  { id: "hours", anchorId: "sec-hours", label: "Hours" },
  { id: "menu", anchorId: "menu", label: "Menu" },
  { id: "photos", anchorId: "sec-photos", label: "Photos" },
  { id: "about", anchorId: "sec-about", label: "About" },
  { id: "info", anchorId: "sec-info", label: "Info" },
  { id: "managers", anchorId: "sec-managers", label: "Managers" },
];

/** Sections the editor renders for a role. Managers-assignment is owner-only
 * (an admin does not get that panel on this page today). */
export function editorSectionsForRole(role: string): EditorSection[] {
  return ALL_SECTIONS.filter((s) => s.id !== "managers" || role === "owner");
}
