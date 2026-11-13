// Types for catering quote requests — mirror backend/app/schemas/catering.py
// (docs/API_CONTRACTS.md "Catering quote requests").
import type { PaginatedResponse } from "@/types/common";

export type CateringItemSize = "full_tray" | "medium_tray" | "flat_tray" | "other";
export type CateringFulfillment = "delivery" | "pickup";
export type CateringRequestStatus = "open" | "closed" | "cancelled";
export type CateringRecipientStatus = "pending" | "quoted" | "declined" | "expired";

/** Server bounds, kept here so the form and the server action agree. */
export const CATERING_MAX_ITEMS = 30;
export const CATERING_MAX_HEADCOUNT = 5000;
export const CATERING_ITEM_NAME_MAX = 120;
export const CATERING_ITEM_NOTE_MAX = 255;
export const CATERING_ITEM_QUANTITY_MAX = 100;
export const CATERING_NOTES_MAX = 2000;
export const CATERING_QUOTE_MAX_DOLLARS = 1_000_000;
export const CATERING_SEARCH_MAX = 100;

export interface CateringConfig {
  max_restaurants: number;
  max_items: number;
  max_headcount: number;
}

export interface EligibleRestaurant {
  location_id: number;
  restaurant_name: string;
  city: string;
  state: string;
  brand_slug: string;
  location_slug: string;
}

export interface EligibleRestaurantList extends PaginatedResponse<EligibleRestaurant> {
  max_restaurants: number;
}

export interface CateringItemInput {
  item_name: string;
  size: CateringItemSize;
  quantity: number;
  note?: string | null;
}

/** Body for POST /catering/requests. */
export interface CateringRequestInput {
  event_date: string; // YYYY-MM-DD
  headcount: number;
  delivery_or_pickup: CateringFulfillment;
  delivery_city?: string | null;
  delivery_zip?: string | null;
  requester_phone?: string | null;
  notes?: string | null;
  items: CateringItemInput[];
  location_ids: number[];
}

export interface CateringItem {
  item_name: string;
  size: CateringItemSize;
  quantity: number;
  note: string | null;
}

export interface CateringRecipient {
  location_id: number;
  restaurant_name: string;
  city: string;
  brand_slug: string;
  location_slug: string;
  status: CateringRecipientStatus;
  quote_amount_cents: number | null;
  quote_note: string | null;
  quoted_at: string | null;
}

export interface CateringRequest {
  id: number;
  event_date: string;
  headcount: number;
  delivery_or_pickup: CateringFulfillment;
  delivery_city: string | null;
  delivery_zip: string | null;
  requester_phone: string | null;
  notes: string | null;
  status: CateringRequestStatus;
  created_at: string;
  expires_at: string;
  items: CateringItem[];
  recipients: CateringRecipient[];
}

export type CateringRequestList = PaginatedResponse<CateringRequest>;

// --- restaurant side -------------------------------------------------------
export interface InboxRow {
  recipient_id: number;
  request_id: number;
  location_id: number;
  restaurant_name: string;
  city: string;
  requester_first_name: string | null;
  event_date: string;
  headcount: number;
  delivery_or_pickup: CateringFulfillment;
  item_count: number;
  request_status: CateringRequestStatus;
  status: CateringRecipientStatus;
  quote_amount_cents: number | null;
  is_unread: boolean;
  created_at: string;
  expires_at: string;
}

export interface InboxList extends PaginatedResponse<InboxRow> {
  unread_count: number;
}

export interface InboxDetail {
  recipient_id: number;
  request_id: number;
  location_id: number;
  restaurant_name: string;
  city: string;
  requester_first_name: string | null;
  /** Null until THIS restaurant has submitted a quote. */
  requester_email: string | null;
  requester_phone: string | null;
  event_date: string;
  headcount: number;
  delivery_or_pickup: CateringFulfillment;
  delivery_city: string | null;
  delivery_zip: string | null;
  notes: string | null;
  items: CateringItem[];
  request_status: CateringRequestStatus;
  status: CateringRecipientStatus;
  quote_amount_cents: number | null;
  quote_note: string | null;
  quoted_at: string | null;
  created_at: string;
  expires_at: string;
  can_respond: boolean;
}

/** Body for PUT /catering/inbox/{id}/response. */
export interface CateringResponseInput {
  decision: "quote" | "decline";
  /** Dollars (a string so "450.50" never goes through float math). */
  amount?: string | null;
  note?: string | null;
}

export interface CateringSettings {
  location_id: number;
  accepts_catering: boolean;
  subscribed: boolean;
  paid_until: string | null;
}

// --- admin -----------------------------------------------------------------
export interface AdminCateringRow {
  id: number;
  requester_email: string;
  requester_name: string | null;
  event_date: string;
  headcount: number;
  status: CateringRequestStatus;
  created_at: string;
  expires_at: string;
  recipient_count: number;
  pending_count: number;
  quoted_count: number;
  declined_count: number;
  expired_count: number;
}

export interface AdminCateringList extends PaginatedResponse<AdminCateringRow> {
  open_count: number;
}

export interface Subscription {
  location_id: number;
  is_paid: boolean;
  paid_until: string | null;
  subscribed: boolean;
}
