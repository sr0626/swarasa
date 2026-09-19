// Types for GET /admin/notifications, matching docs/API_CONTRACTS.md
// "Admin notifications" — the data behind the admin bell in the top bar.
import type { ReportCategory } from "./listingReport";

export interface ClaimNotificationItem {
  claim_id: number;
  brand_id: number;
  brand_name: string;
  submitted_at: string;
}

export interface ReportNotificationItem {
  report_id: number;
  brand_id: number;
  brand_name: string;
  category: ReportCategory;
  submitted_at: string;
}

export interface NewUserNotificationItem {
  owner_id: number;
  /** full_name, else email — ready to render. */
  display: string;
  email: string;
  /** Always "owner" today (only `owner_account` rows are DB-derivable). */
  role: string;
  created_at: string;
}

export interface NotificationSection<TItem> {
  /** Full total in the section; `items` is capped (5). */
  count: number;
  items: TItem[];
}

export interface AdminNotifications {
  claims: NotificationSection<ClaimNotificationItem>;
  reports: NotificationSection<ReportNotificationItem>;
  new_users: NotificationSection<NewUserNotificationItem>;
  /** Badge number: pending claims + new reports (sign-ups excluded). */
  total: number;
  new_users_window_days: number;
}
