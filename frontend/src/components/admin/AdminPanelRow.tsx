// Layout wrapper for the admin list pages' Summary panel and Search & filters
// panel (both CollapsiblePanels). On phones they stack; from `md` up they sit
// side by side in one row (Summary left, Search right) so the two collapsed
// header bars share a line. CSS-only: CollapsiblePanel exposes its state as
// `data-panel-open`, and an expanded panel spans both columns so its form /
// chips have room (a collapsed sibling then wraps to its own row). A lone
// panel (no summary data) also spans the full width. Panel bodies stay in the
// DOM, so persistence and plain-GET form submission are unaffected.
import type { ReactNode } from "react";

/** className for a CollapsiblePanel rendered inside the row (the row owns the spacing). */
export const PANEL_IN_ROW = "mt-0";

export default function AdminPanelRow({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 md:[&>*:only-child]:col-span-2 md:[&>[data-panel-open=true]]:col-span-2">
      {children}
    </div>
  );
}
