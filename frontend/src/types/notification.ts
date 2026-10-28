// Types for GET /notifications, matching docs/API_CONTRACTS.md
// "Notifications" — the in-app deal alerts behind the bell in the top bar
// (registered_user only).

export type NotificationKind = "deal_new";

export interface UserNotification {
  id: number;
  kind: NotificationKind;
  /** Snapshot of the deal title when the alert was created. */
  title: string;
  location_id: number;
  /** The location's own name when set, else the brand name. */
  restaurant_name: string;
  city: string;
  brand_slug: string;
  location_slug: string;
  created_at: string;
  /** null = unread. */
  read_at: string | null;
}

export interface NotificationList {
  results: UserNotification[];
  page: number;
  page_size: number;
  total: number;
  /** Unread alerts across ALL pages. */
  unread_count: number;
}

export interface NotificationsReadAll {
  marked_read: number;
}
