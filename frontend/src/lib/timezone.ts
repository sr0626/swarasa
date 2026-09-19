// Best-effort IANA timezone for a US state. Pure lookup; used only to
// pre-fill `timezone` when an owner adds a restaurant (the backend default
// is America/Chicago, which is wrong for most of the country). States that
// straddle two zones map to the zone covering most of their population;
// the owner can correct it in the location editor.

const EASTERN = "America/New_York";
const CENTRAL = "America/Chicago";
const MOUNTAIN = "America/Denver";
const PACIFIC = "America/Los_Angeles";

const STATE_TIMEZONES: Record<string, string> = {
  AL: CENTRAL, AK: "America/Anchorage", AZ: "America/Phoenix", AR: CENTRAL,
  CA: PACIFIC, CO: MOUNTAIN, CT: EASTERN, DE: EASTERN, DC: EASTERN,
  FL: EASTERN, GA: EASTERN, HI: "Pacific/Honolulu", ID: MOUNTAIN, IL: CENTRAL,
  IN: EASTERN, IA: CENTRAL, KS: CENTRAL, KY: EASTERN, LA: CENTRAL,
  ME: EASTERN, MD: EASTERN, MA: EASTERN, MI: EASTERN, MN: CENTRAL,
  MS: CENTRAL, MO: CENTRAL, MT: MOUNTAIN, NE: CENTRAL, NV: PACIFIC,
  NH: EASTERN, NJ: EASTERN, NM: MOUNTAIN, NY: EASTERN, NC: EASTERN,
  ND: CENTRAL, OH: EASTERN, OK: CENTRAL, OR: PACIFIC, PA: EASTERN,
  RI: EASTERN, SC: EASTERN, SD: CENTRAL, TN: CENTRAL, TX: CENTRAL,
  UT: MOUNTAIN, VT: EASTERN, VA: EASTERN, WA: PACIFIC, WV: EASTERN,
  WI: CENTRAL, WY: MOUNTAIN,
};

export const DEFAULT_TIMEZONE = CENTRAL;

export function timezoneForState(state: string): string {
  return STATE_TIMEZONES[state.trim().toUpperCase()] ?? DEFAULT_TIMEZONE;
}
