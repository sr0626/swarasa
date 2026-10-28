// <title> / meta-description builders for the city landing pages. Pure:
// unit-tested with `node --test`. The root layout's title template appends
// " | Swarasa", so these return the part before it.

interface CityLabelInput {
  city: string;
  state: string;
}

/** "Irving, TX" (just the city when the state is blank). */
export function cityLabel({ city, state }: CityLabelInput): string {
  return state ? `${city}, ${state}` : city;
}

/** `Indian Restaurants in Irving, TX` (+ ` — Page 2` for later pages, so
 * paginated pages don't share one <title>). */
export function buildCityTitle(input: CityLabelInput, page = 1): string {
  const base = `Indian Restaurants in ${cityLabel(input)}`;
  return page > 1 ? `${base} — Page ${page}` : base;
}

export function buildCityDescription(input: CityLabelInput & { count: number }, page = 1): string {
  const noun = input.count === 1 ? "Indian restaurant" : "Indian restaurants";
  const base =
    `Browse ${input.count} verified ${noun} in ${cityLabel(input)} — regional cuisines, ` +
    `opening hours and which ones have deals today.`;
  return page > 1 ? `${base} Page ${page}.` : base;
}

/** Short H1 (the title without the page suffix). */
export function buildCityHeading(input: CityLabelInput): string {
  return `Indian Restaurants in ${cityLabel(input)}`;
}

export const CITY_INDEX_TITLE = "Indian Restaurants by City";

export function buildCityIndexDescription(cityCount: number, locationCount: number): string {
  if (cityCount === 0) return "Browse Indian restaurants by city on Swarasa.";
  const cities = cityCount === 1 ? "1 city" : `${cityCount} cities`;
  const places = locationCount === 1 ? "1 Indian restaurant" : `${locationCount} Indian restaurants`;
  return `Find ${places} across ${cities} — pick your city to browse verified restaurants, cuisines and deals.`;
}
