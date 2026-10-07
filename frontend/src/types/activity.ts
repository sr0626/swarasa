// Types for `GET /auth/me/activity` — docs/API_CONTRACTS.md
// "GET /auth/me/activity". Matches backend/app/schemas/audit.py exactly.

/** One friendly changed field inside an activity event (already mapped:
 * "Live" / "Hidden", "(972) 555-0142"; `null` = no value, shown as a dash). */
export interface ActivityChange {
  field: string;
  label: string;
  old: string | null;
  new: string | null;
}

export interface OwnerActivity {
  id: number;
  table_name: string;
  action: string;

  // Raw role from audit_log ("owner" | "manager" | "admin"). `actor_label`
  // is what the UI actually displays -- see backend docstring for the
  // resolution order ("You" for the caller's own actions, a resolved
  // Cognito email, or a role + truncated-id fallback when neither
  // applies). `actor_resolved` is false only for that last fallback case,
  // so the UI can render the gap honestly instead of implying a real name
  // was found.
  actor_role: string;
  actor_label: string;
  actor_resolved: boolean;

  // Short human-readable summary (e.g. "Location hours updated") derived
  // server-side from table_name/action/old_val/new_val -- never a raw
  // JSON diff.
  summary: string;

  created_at: string;

  // --- Detail fields (added 2026-09-24; optional so an older API degrades to
  // the summary-only row) --------------------------------------------------
  brand_id?: number | null;
  restaurant_name?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  /** IANA timezone `created_at` is displayed in (the location's own). */
  timezone?: string;
  actor_email?: string | null;
  /** "Owner" | "Manager" | "Platform admin". */
  actor_role_label?: string;
  /** Empty for a create/delete (or an unchanged save): show `summary` alone. */
  changes?: ActivityChange[];
}
