"use server";

// Server Actions for catering quote requests. Same "keep the Cognito access
// token server-side, re-derive the session in every action" shape as
// lib/actions/notifications.ts. The role checks below are a convenience —
// the backend re-validates role, eligibility and ownership on every call.
import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/client";
import {
  cancelCateringRequest,
  createCateringRequest,
  listCateringRestaurants,
  respondToCateringRequest,
  setCateringSettings,
  setManualSubscription,
} from "@/lib/api/catering";
import { getServerSession } from "@/lib/auth/session";
import { parseQuoteAmount, QUOTE_NOTE_MAX } from "@/lib/catering/quoteForm";
import type {
  CateringRequest,
  CateringRequestInput,
  CateringSettings,
  EligibleRestaurantList,
  InboxDetail,
  Subscription,
} from "@/types/catering";
import { CATERING_SEARCH_MAX } from "@/types/catering";
import type { Session, UserRole } from "@/types/auth";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function requireRole(
  roles: UserRole[],
  deniedMessage: string
): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!roles.includes(session.role)) return { ok: false, error: deniedMessage };
  return { ok: true, session };
}

function apiMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_ERROR;
}

// --- requester -------------------------------------------------------------
export async function searchCateringRestaurantsAction(
  query: { city: string; q: string; page: number }
): Promise<ActionResult<EligibleRestaurantList>> {
  const auth = await requireRole(["registered_user"], "Only signed-in diners can request catering quotes.");
  if (!auth.ok) return auth;
  try {
    const data = await listCateringRestaurants(
      {
        city: query.city.trim().slice(0, CATERING_SEARCH_MAX) || undefined,
        q: query.q.trim().slice(0, CATERING_SEARCH_MAX) || undefined,
        page: Math.max(1, Math.floor(query.page) || 1),
        page_size: 20,
      },
      auth.session.accessToken
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: apiMessage(error) };
  }
}

export async function submitCateringRequestAction(
  input: CateringRequestInput
): Promise<ActionResult<CateringRequest>> {
  const auth = await requireRole(["registered_user"], "Only signed-in diners can request catering quotes.");
  if (!auth.ok) return auth;
  try {
    const data = await createCateringRequest(input, auth.session.accessToken);
    revalidatePath("/account/catering");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      // Generic by design: the API never says which restaurant failed or why.
      return { ok: false, error: error.message };
    }
    return { ok: false, error: apiMessage(error) };
  }
}

export async function cancelCateringRequestAction(
  requestId: number
): Promise<ActionResult<CateringRequest>> {
  const auth = await requireRole(["registered_user"], "Only the person who sent the request can cancel it.");
  if (!auth.ok) return auth;
  try {
    const data = await cancelCateringRequest(requestId, auth.session.accessToken);
    revalidatePath("/account/catering");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { ok: false, error: "That request no longer exists." };
    }
    return { ok: false, error: apiMessage(error) };
  }
}

// --- restaurant side -------------------------------------------------------
export async function respondToCateringAction(
  recipientId: number,
  input: { decision: "quote" | "decline"; amount: string; note: string }
): Promise<ActionResult<InboxDetail>> {
  const auth = await requireRole(["owner", "manager", "admin"], "You can't answer catering requests.");
  if (!auth.ok) return auth;
  if (input.note.length > QUOTE_NOTE_MAX) {
    return { ok: false, error: `Your note can be at most ${QUOTE_NOTE_MAX} characters.` };
  }
  let amount: string | null = null;
  if (input.decision === "quote") {
    const parsed = parseQuoteAmount(input.amount);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    amount = parsed.amount;
  }
  try {
    const data = await respondToCateringRequest(
      recipientId,
      { decision: input.decision, amount, note: input.note.trim() || null },
      auth.session.accessToken
    );
    revalidatePath("/portal/catering");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { ok: false, error: "That request is no longer available." };
    }
    return { ok: false, error: apiMessage(error) };
  }
}

export async function setCateringOptInAction(
  locationId: number,
  accepts: boolean
): Promise<ActionResult<CateringSettings>> {
  const auth = await requireRole(["owner", "manager", "admin"], "You can't change this setting.");
  if (!auth.ok) return auth;
  try {
    const data = await setCateringSettings(locationId, accepts, auth.session.accessToken);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: apiMessage(error) };
  }
}

// --- admin -----------------------------------------------------------------
export async function setManualSubscriptionAction(
  locationId: number,
  isPaid: boolean,
  paidUntil: string | null
): Promise<ActionResult<Subscription>> {
  const auth = await requireRole(["admin"], "Only admins can change a subscription.");
  if (!auth.ok) return auth;
  try {
    const data = await setManualSubscription(
      locationId,
      { is_paid: isPaid, paid_until: isPaid ? paidUntil : null },
      auth.session.accessToken
    );
    revalidatePath("/admin/listings");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: apiMessage(error) };
  }
}
