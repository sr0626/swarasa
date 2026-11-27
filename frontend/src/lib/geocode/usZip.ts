// Does a ZIP code belong to a state? Mirrors backend/app/core/us_zip.py, which
// is the authority (tests/unit/test_us_zip.py keeps the two tables equal).
// Used only to skip the slow address lookup for a pair the API will refuse.
// No imports, so it runs directly under the node test runner.

export const ZIP_PREFIX_RANGES: Record<string, ReadonlyArray<readonly [number, number]>> = {
  AL: [[350, 369]],
  AK: [[995, 999]],
  AZ: [[850, 865]],
  AR: [[716, 729], [755, 755]],
  CA: [[900, 961]],
  CO: [[800, 816]],
  CT: [[60, 69]],
  DE: [[197, 199]],
  DC: [[200, 205], [569, 569]],
  FL: [[320, 349]],
  GA: [[300, 319], [398, 399]],
  HI: [[967, 968]],
  ID: [[832, 838]],
  IL: [[600, 629]],
  IN: [[460, 479]],
  IA: [[500, 528]],
  KS: [[660, 679]],
  KY: [[400, 427]],
  LA: [[700, 714]],
  ME: [[39, 49]],
  MD: [[206, 219]],
  MA: [[10, 27], [55, 55]],
  MI: [[480, 499]],
  MN: [[550, 567]],
  MS: [[386, 397]],
  MO: [[630, 658]],
  MT: [[590, 599]],
  NE: [[680, 693]],
  NV: [[889, 898]],
  NH: [[30, 38]],
  NJ: [[70, 89]],
  NM: [[870, 884]],
  NY: [[5, 5], [63, 63], [100, 149]],
  NC: [[270, 289]],
  ND: [[580, 588]],
  OH: [[430, 459]],
  OK: [[730, 749]],
  OR: [[970, 979]],
  PA: [[150, 196]],
  RI: [[28, 29]],
  SC: [[290, 299]],
  SD: [[570, 577]],
  TN: [[370, 385]],
  TX: [[733, 733], [750, 799], [885, 885]],
  UT: [[840, 847]],
  VT: [[50, 54], [56, 59]],
  VA: [[201, 201], [220, 246]],
  WA: [[980, 994]],
  WV: [[247, 268]],
  WI: [[530, 549]],
  WY: [[820, 831], [834, 834]],
};

const PREFIX = /^\s*(\d{3})\d{2}(?:-\d{4})?\s*$/;

/** True when it matches, and also when we can't tell (unknown state or an
 * unreadable ZIP): this must never block on missing data. */
export function zipMatchesState(postalCode: string, state: string): boolean {
  const ranges = ZIP_PREFIX_RANGES[state.trim().toUpperCase()];
  const match = PREFIX.exec(postalCode);
  if (!ranges || !match) return true;
  const prefix = Number(match[1]);
  return ranges.some(([low, high]) => prefix >= low && prefix <= high);
}
