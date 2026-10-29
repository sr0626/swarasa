// Types for GET /admin/queue-counts, matching docs/API_CONTRACTS.md
// "Admin queue counts" -- the data behind the admin menu's Work queue badges.
export interface AdminQueueCounts {
  claims: { pending: number; overdue: number };
  messages: { open: number };
  reports: { new: number };
  reopen_requests: { pending: number };
  total: number;
}
