// Pure label builder for the Contact admin "Related location" dropdown
// (kept free of API imports so it is unit-testable under `node --test`).

/** "Brand — Downtown, 123 Main St, Irving" */
export function locationOptionLabel(
  brandName: string,
  location: { location_name: string | null; address_line1: string; city: string }
): string {
  const name = location.location_name ? `${brandName} — ${location.location_name}` : brandName;
  return `${name}, ${location.address_line1}, ${location.city}`;
}
