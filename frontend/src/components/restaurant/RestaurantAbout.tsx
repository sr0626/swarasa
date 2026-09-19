// Public "About" block for the restaurant detail page: the owner/manager-
// authored `about` text (rendered as paragraphs) plus `specialties` chips
// (docs/API_CONTRACTS.md "GET /locations/{id}"). Renders nothing when both
// are empty so an unset listing shows no empty section. Accepts
// `undefined` too, so it stays safe against an API that hasn't deployed
// these fields yet.
//
// Usage: <RestaurantAbout about={location.about} specialties={location.specialties} />

interface RestaurantAboutProps {
  about?: string | null;
  specialties?: string[] | null;
}

export default function RestaurantAbout({ about, specialties }: RestaurantAboutProps) {
  const paragraphs = (about ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chips = (specialties ?? []).filter((s) => s.trim().length > 0);

  if (paragraphs.length === 0 && chips.length === 0) return null;

  return (
    <section aria-labelledby="about-heading">
      <h2 id="about-heading" className="font-display text-xl font-bold text-brand-ink">
        About
      </h2>

      {paragraphs.length > 0 && (
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-brand-ink-muted">
          {paragraphs.map((paragraph, index) => (
            // whitespace-pre-line keeps single line breaks inside a paragraph.
            <p key={index} className="whitespace-pre-line">
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-brand-ink">Specialties</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li
                key={chip}
                className="rounded-brand-pill bg-brand-bg px-3 py-1 text-sm text-brand-ink ring-1 ring-brand-border"
              >
                {chip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
