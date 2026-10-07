// Typed client for "Contact admin" — docs/API_CONTRACTS.md "Contact admin".
import { apiFetch, toQueryString } from "./client";
import type { PaginationParams } from "@/types/common";
import type {
  AdminMessage,
  AdminMessageListResponse,
  AdminMessageStatus,
  ContactAdminInput,
  ContactAdminReceipt,
} from "@/types/adminMessage";

/** POST /contact-admin — auth: owner or manager. 429 after 5 messages in an hour. */
export async function contactAdmin(
  input: ContactAdminInput,
  accessToken: string
): Promise<ContactAdminReceipt> {
  return apiFetch<ContactAdminReceipt>(
    "/contact-admin",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/**
 * GET /admin/messages — auth: admin. `status` omitted = every message;
 * `q` searches subject, body, sender email and name.
 */
export async function listAdminMessages(
  params: PaginationParams & { status?: AdminMessageStatus; q?: string },
  accessToken: string
): Promise<AdminMessageListResponse> {
  const query = toQueryString({
    status: params.status,
    q: params.q,
    page: params.page,
    page_size: params.page_size,
  });
  return apiFetch<AdminMessageListResponse>(
    `/admin/messages${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/** PATCH /admin/messages/{id} — auth: admin. Resolve or re-open. */
export async function updateAdminMessage(
  id: number,
  status: AdminMessageStatus,
  accessToken: string
): Promise<AdminMessage> {
  return apiFetch<AdminMessage>(
    `/admin/messages/${id}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    { accessToken }
  );
}
