// What a hidden listing (Coming soon / Import issues) still needs before it can
// be activated, shown directly in its row on /admin/listings: one amber chip per
// missing item ("Missing hours"), or a green "Ready to activate" pill when
// nothing is missing. Text always carries the meaning (not colour alone).
// Renders nothing for a location that is not in a setup status.
import { setupChipsSummary, setupChipsView } from "@/lib/adminListingSetup";

export default function SetupMissingChips({
  status,
  setupMissing,
}: {
  status: string;
  setupMissing?: readonly string[] | null;
}) {
  const view = setupChipsView(status, setupMissing);
  if (!view) return null;
  const tag = "inline-flex items-center rounded-brand-pill px-2 py-0.5 text-xs font-semibold";
  return (
    <ul
      aria-label={`Setup status: ${setupChipsSummary(view)}`}
      data-setup-ready={view.ready ? "true" : "false"}
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      {view.ready ? (
        <li className={`${tag} bg-brand-success-bg text-brand-success`}>
          <span aria-hidden="true" className="mr-1">
            ✓
          </span>
          {view.readyLabel}
        </li>
      ) : (
        view.chips.map((chip) => (
          <li key={chip.key} className={`${tag} bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-400`}>
            <span aria-hidden="true" className="mr-1">
              !
            </span>
            {chip.label}
          </li>
        ))
      )}
    </ul>
  );
}
