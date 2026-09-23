// Typed client for POST /activity/tile-click — docs/API_CONTRACTS.md
// "Activity tracking (`/activity`)". registered_user only. Called from the
// same-origin route handler (app/api/activity/tile-click/route.ts), never
// from a component directly: the Cognito token lives in an httpOnly cookie
// the browser can't read.
import { apiFetch } from "./client";
import type { TileClickInput } from "@/types/userActivity";

/** 204 on success. Throws `ApiError` (401/403/404/422) otherwise. */
export async function recordTileClick(
  input: TileClickInput,
  accessToken: string
): Promise<void> {
  await apiFetch<void>(
    "/activity/tile-click",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}
