// Typed client for GET /admin/queue-counts -- docs/API_CONTRACTS.md
// "Admin queue counts".
import { apiFetch } from "./client";
import type { AdminQueueCounts } from "@/types/adminQueueCounts";

/** Give-up bound for the badge call: the menu must never hold a page render up. */
export const QUEUE_COUNTS_TIMEOUT_MS = 1_500;

/**
 * GET /admin/queue-counts -- auth: admin. Never cached (a stale badge defeats
 * the point) and bounded to ~1.5s; callers treat any failure as "no badges".
 */
export async function getAdminQueueCounts(accessToken: string): Promise<AdminQueueCounts> {
  return apiFetch<AdminQueueCounts>(
    "/admin/queue-counts",
    { method: "GET", cache: "no-store" },
    { accessToken, timeoutMs: QUEUE_COUNTS_TIMEOUT_MS }
  );
}
