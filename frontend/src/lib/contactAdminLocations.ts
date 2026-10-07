// Server-side loader for the optional "Related location" dropdown on the
// Contact admin form: an owner's locations (across all their brands) or a
// manager's assigned locations. Best-effort — the dropdown is optional, so a
// failure yields an empty list rather than blocking the form.
import { getMyManagedLocations } from "@/lib/api/auth";
import { getMyRestaurants, getRestaurantLocations } from "@/lib/api/restaurants";
import { mapWithConcurrency } from "@/lib/concurrency";
import { locationOptionLabel } from "@/lib/locationOptionLabel";
import type { ContactAdminLocationOption } from "@/types/adminMessage";

const FETCH_CONCURRENCY = 5;

export async function loadContactAdminLocationOptions(
  role: "owner" | "manager",
  accessToken: string
): Promise<ContactAdminLocationOption[]> {
  try {
    if (role === "manager") {
      const page = await getMyManagedLocations({ page: 1, page_size: 100 }, accessToken);
      return page.results.map((l) => ({ id: l.id, label: locationOptionLabel(l.brand_name, l) }));
    }
    const brands = await getMyRestaurants({ page: 1, page_size: 100 }, accessToken);
    const perBrand = await mapWithConcurrency(
      brands.results,
      FETCH_CONCURRENCY,
      async (brand): Promise<ContactAdminLocationOption[]> => {
        try {
          const page = await getRestaurantLocations(
            brand.id,
            { page: 1, page_size: 100 },
            accessToken
          );
          return page.results.map((l) => ({ id: l.id, label: locationOptionLabel(brand.name, l) }));
        } catch {
          return [];
        }
      }
    );
    return perBrand.flat();
  } catch {
    return [];
  }
}
