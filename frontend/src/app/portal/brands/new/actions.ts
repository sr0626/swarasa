"use server";

// Server Action backing CreateBrandForm.tsx — same "keep the Cognito
// session token server-side" rationale as app/claim/actions.ts and
// app/portal/locations/[id]/actions.ts. POST /restaurants is owner-only
// (docs/API_CONTRACTS.md "POST /restaurants"), re-checked here even though
// the backend enforces it too.
import { ApiError } from "@/lib/api/client";
import { createRestaurant } from "@/lib/api/restaurants";
import { getServerSession } from "@/lib/auth/session";
import { createRestaurantSchema } from "@/lib/validation/restaurant";
import type { RestaurantBrand } from "@/types/restaurant";

type ActionResult =
  | { ok: true; data: RestaurantBrand }
  | { ok: false; error: string };

export async function createBrandAction(input: unknown): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (session.role !== "owner") {
    return { ok: false, error: "Only an owner account can add a restaurant." };
  }

  const parsed = createRestaurantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the form and try again.",
    };
  }

  try {
    const brand = await createRestaurant(parsed.data, session.accessToken);
    return { ok: true, data: brand };
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : "Something went wrong creating your restaurant.";
    return { ok: false, error: message };
  }
}
