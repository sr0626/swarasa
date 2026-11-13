// Typed client for catering quote requests — docs/API_CONTRACTS.md "Catering
// quote requests". Requester calls need a registered_user token; the inbox and
// settings calls need an owner / assigned manager / admin token; the
// eligibility probe is public.
import { apiFetch, toQueryString } from "./client";
import type { PaginationParams } from "@/types/common";
import type {
  AdminCateringList,
  CateringConfig,
  CateringRequest,
  CateringRequestInput,
  CateringRequestList,
  CateringRequestStatus,
  CateringResponseInput,
  CateringSettings,
  EligibleRestaurant,
  EligibleRestaurantList,
  InboxDetail,
  InboxList,
  Subscription,
} from "@/types/catering";

// --- requester -------------------------------------------------------------
/** GET /catering/config — registered_user. */
export async function getCateringConfig(accessToken: string): Promise<CateringConfig> {
  return apiFetch<CateringConfig>("/catering/config", { method: "GET" }, { accessToken });
}

/** GET /catering/restaurants — registered_user. Only subscribed + opted-in public locations. */
export async function listCateringRestaurants(
  params: PaginationParams & { city?: string; q?: string },
  accessToken: string
): Promise<EligibleRestaurantList> {
  const query = toQueryString({
    city: params.city,
    q: params.q,
    page: params.page,
    page_size: params.page_size,
  });
  return apiFetch<EligibleRestaurantList>(
    `/catering/restaurants${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/**
 * GET /catering/eligibility/{id} — PUBLIC. The restaurant's public picker
 * fields when it can receive catering requests, else null (unknown, hidden,
 * free, lapsed and not-opted-in are indistinguishable).
 */
export async function getCateringEligibility(locationId: number): Promise<EligibleRestaurant | null> {
  try {
    const res = await apiFetch<{ eligible: boolean; restaurant: EligibleRestaurant | null }>(
      `/catering/eligibility/${locationId}`,
      { method: "GET" },
      { revalidateSeconds: 60, timeoutMs: 4000 }
    );
    return res.eligible === true ? res.restaurant : null;
  } catch {
    // Best-effort: a failed probe just hides the entry point.
    return null;
  }
}

/** POST /catering/requests — registered_user. */
export async function createCateringRequest(
  input: CateringRequestInput,
  accessToken: string
): Promise<CateringRequest> {
  return apiFetch<CateringRequest>(
    "/catering/requests",
    { method: "POST", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** GET /catering/requests — registered_user, own requests, newest first. */
export async function listMyCateringRequests(
  params: PaginationParams,
  accessToken: string
): Promise<CateringRequestList> {
  const query = toQueryString({ page: params.page, page_size: params.page_size });
  return apiFetch<CateringRequestList>(
    `/catering/requests${query}`,
    { method: "GET" },
    { accessToken }
  );
}

/** POST /catering/requests/{id}/cancel — registered_user, own request. */
export async function cancelCateringRequest(
  requestId: number,
  accessToken: string
): Promise<CateringRequest> {
  return apiFetch<CateringRequest>(
    `/catering/requests/${requestId}/cancel`,
    { method: "POST" },
    { accessToken }
  );
}

// --- restaurant side -------------------------------------------------------
/** GET /catering/inbox — owner / manager / admin; only their locations. */
export async function getCateringInbox(
  params: PaginationParams & { location_id?: number },
  accessToken: string
): Promise<InboxList> {
  const query = toQueryString({
    location_id: params.location_id,
    page: params.page,
    page_size: params.page_size,
  });
  return apiFetch<InboxList>(`/catering/inbox${query}`, { method: "GET" }, { accessToken });
}

/** GET /catering/inbox/{recipient_id} — marks the request viewed. */
export async function getCateringInboxDetail(
  recipientId: number,
  accessToken: string
): Promise<InboxDetail> {
  return apiFetch<InboxDetail>(
    `/catering/inbox/${recipientId}`,
    { method: "GET" },
    { accessToken }
  );
}

/** PUT /catering/inbox/{recipient_id}/response — submit/edit a quote, or decline. */
export async function respondToCateringRequest(
  recipientId: number,
  input: CateringResponseInput,
  accessToken: string
): Promise<InboxDetail> {
  return apiFetch<InboxDetail>(
    `/catering/inbox/${recipientId}/response`,
    { method: "PUT", body: JSON.stringify(input) },
    { accessToken }
  );
}

/** GET /locations/{id}/catering-settings — owner / assigned manager / admin. */
export async function getCateringSettings(
  locationId: number,
  accessToken: string
): Promise<CateringSettings> {
  return apiFetch<CateringSettings>(
    `/locations/${locationId}/catering-settings`,
    { method: "GET" },
    { accessToken }
  );
}

/** PUT /locations/{id}/catering-settings — the opt-in toggle. */
export async function setCateringSettings(
  locationId: number,
  acceptsCatering: boolean,
  accessToken: string
): Promise<CateringSettings> {
  return apiFetch<CateringSettings>(
    `/locations/${locationId}/catering-settings`,
    { method: "PUT", body: JSON.stringify({ accepts_catering: acceptsCatering }) },
    { accessToken }
  );
}

// --- admin -----------------------------------------------------------------
/** GET /admin/catering — admin, read-only. */
export async function listAdminCatering(
  params: PaginationParams & { q?: string; status?: CateringRequestStatus },
  accessToken: string
): Promise<AdminCateringList> {
  const query = toQueryString({
    q: params.q,
    status: params.status,
    page: params.page,
    page_size: params.page_size,
  });
  return apiFetch<AdminCateringList>(`/admin/catering${query}`, { method: "GET" }, { accessToken });
}

/** PUT /admin/locations/{id}/subscription — admin; MANUAL paid flag, no payment taken. */
export async function setManualSubscription(
  locationId: number,
  input: { is_paid: boolean; paid_until: string | null },
  accessToken: string
): Promise<Subscription> {
  return apiFetch<Subscription>(
    `/admin/locations/${locationId}/subscription`,
    { method: "PUT", body: JSON.stringify(input) },
    { accessToken }
  );
}
