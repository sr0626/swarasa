"use server";

// Server Actions behind the admin bulk import page (AdminImportPanel.tsx).
// The Cognito access token stays server-side and the admin role is
// re-checked, same shape as admin/taxonomy/actions.ts. Geocoding also lives
// here: the API Lambda has no internet access, but this Amplify SSR compute
// does, so unplaced rows are geocoded (US Census, then Nominatim — the same
// chain as the owner "add restaurant" flow) just before each chunk is written.
import { ApiError } from "@/lib/api/client";
import { commitImportRows, validateImportRows } from "@/lib/api/adminImport";
import { geocodeAddress } from "@/lib/geocode";
import { getServerSession } from "@/lib/auth/session";
import { IMPORT_LIMITS } from "@/lib/adminImportCsv";
import { geocodeRows } from "@/lib/adminImportRun";
import type { CommitResponse, ImportRowInput, ValidateResponse } from "@/types/adminImport";

export type ValidateActionResult = ({ ok: true } & ValidateResponse) | { ok: false; error: string };
export type CommitActionResult =
  | ({ ok: true; geocoded: number } & CommitResponse)
  | { ok: false; error: string };

/** Time the geocoding pass may take per chunk, leaving room for the API call inside the host's request limit. */
const GEOCODE_DEADLINE_MS = 14_000;
const GEOCODE_CONCURRENCY = 4;

async function adminToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (session.role !== "admin") return { ok: false, error: "Only admins can import listings." };
  return { ok: true, token: session.accessToken };
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return "The server rejected this batch. Re-check the file and try again.";
    if (error.status === 401 || error.status === 403) return "Your session has expired. Please sign in again.";
    return "The server could not process this batch. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

/** POST /admin/import/validate — dry run, writes nothing. */
export async function validateImportAction(rows: ImportRowInput[]): Promise<ValidateActionResult> {
  const admin = await adminToken();
  if (!admin.ok) return admin;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "There are no rows to check." };
  if (rows.length > IMPORT_LIMITS.maxRows) {
    return { ok: false, error: `Too many rows (limit ${IMPORT_LIMITS.maxRows}).` };
  }
  try {
    return { ok: true, ...(await validateImportRows(rows, admin.token)) };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}

/** Geocode the rows that lack coordinates, then POST /admin/import/commit for this chunk. */
export async function importChunkAction(
  rows: ImportRowInput[],
  includeWarnings: boolean
): Promise<CommitActionResult> {
  const admin = await adminToken();
  if (!admin.ok) return admin;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "There are no rows to import." };
  if (rows.length > IMPORT_LIMITS.chunkSize) {
    return { ok: false, error: `Too many rows in one batch (limit ${IMPORT_LIMITS.chunkSize}).` };
  }

  const { rows: placed, geocoded } = await geocodeRows(
    rows,
    async (row) => {
      const hit = await geocodeAddress({
        address_line1: row.address_line1 ?? "",
        city: row.city ?? "",
        state: row.state ?? "",
        postal_code: row.postal_code ?? "",
      });
      return hit ? { latitude: hit.latitude, longitude: hit.longitude } : null;
    },
    { concurrency: GEOCODE_CONCURRENCY, deadlineMs: GEOCODE_DEADLINE_MS, now: () => Date.now() }
  );

  try {
    return { ok: true, geocoded, ...(await commitImportRows(placed, includeWarnings, admin.token)) };
  } catch (error) {
    return { ok: false, error: messageFor(error) };
  }
}
