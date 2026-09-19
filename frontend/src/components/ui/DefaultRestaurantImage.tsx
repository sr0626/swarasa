// The default image for any restaurant image slot with no uploaded cover
// photo -- a coffee-cup line illustration (CoffeeCupIcon, drawn in-house, no
// third-party image) in low-opacity cream, drawn over the parent's warm
// gradient. One shared component so the tiles, the detail-page hero and any
// future image slot stay identical (direct user request 2026-09-19: "use the
// coffee image as the default image wherever it is needed").
//
// Must be rendered inside a `relative` container that already carries the
// `bg-brand-warm-gradient` background; it fills that container with a
// consistent margin. A thin strokeWidth keeps the 24px-grid icon delicate
// when scaled up to fill the slot.
import { CoffeeCupIcon } from "@/components/ui/icons";

export default function DefaultRestaurantImage() {
  return (
    <div className="absolute inset-6 flex items-center justify-center">
      <CoffeeCupIcon className="h-full w-full text-brand-bg/60" strokeWidth={0.6} />
    </div>
  );
}
