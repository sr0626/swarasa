// One-time banner on the location editor right after the "Add restaurant" /
// "Add location" flow creates a listing (`?new=exact|approximate|none`, set by
// components/portal/CreateBrandForm.tsx). Server-renderable — no state.
// The map-position wording matters: without coordinates a listing is
// invisible to geo search, so the owner has to be told, not left guessing.
type MapPosition = "exact" | "approximate" | "none";

export function parseNewListingParam(value: string | string[] | undefined): MapPosition | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "exact" || v === "approximate" || v === "none" ? v : null;
}

export default function NewListingNotice({ mapPosition }: { mapPosition: MapPosition }) {
  const warn = mapPosition !== "exact";
  return (
    <div
      role="status"
      className={`mt-4 rounded-brand-control px-4 py-3 text-sm ${
        warn ? "bg-brand-chip text-brand-ink" : "bg-brand-success-bg text-brand-success"
      }`}
    >
      <p className="font-semibold">Your listing has been added — it isn&rsquo;t live yet.</p>
      <p className="mt-1">
        Finish the checklist below (opening hours are next), then activate it to make it public.
        Photos and an About section are optional and can come later.
      </p>
      {mapPosition === "approximate" && (
        <p className="mt-2 border-t border-brand-border pt-2">
          <span className="font-semibold">Map position is approximate.</span> We could only place
          you by ZIP code, so nearby searches may show a slightly off location. Check the street
          address under Location details and save to try again, or contact us and we&rsquo;ll set
          it for you.
        </p>
      )}
      {mapPosition === "none" && (
        <p className="mt-2 border-t border-brand-border pt-2">
          <span className="font-semibold">We couldn&rsquo;t find your address on the map.</span>{" "}
          Your listing won&rsquo;t appear in nearby searches until it has a map position. Check the
          street address under Location details and save to try again, or contact us and we&rsquo;ll
          set it for you.
        </p>
      )}
    </div>
  );
}
