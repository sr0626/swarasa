// Default/launch-city display name — matches the backend's own DFW
// fallback (search_service.py's `_DEFAULT_LAT`/`_DEFAULT_LNG`, commented
// "DFW default fallback (Dallas, TX city center)"). Centralized here
// instead of hardcoded per-page so adding a second launch city later is a
// config change, not a hunt-and-replace across the frontend (direct user
// instruction 2026-09-18: "assume this supports multi cities ... make
// this dynamic based on the city chosen").
//
// This is the DEFAULT shown when no city has actually been chosen (e.g.
// the homepage, before any search). Pages that DO have a real signal for
// what the visitor chose (search/page.tsx's `location` query param, the
// one real "chosen city" value that exists in Phase 1 — see that file's
// own header comment on which search params are real vs. round-tripped)
// should prefer that over this constant, falling back to it only when
// empty.
export const DEFAULT_CITY_LABEL = "Dallas-Fort Worth";
