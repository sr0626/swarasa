// Types for `GET /auth/me/activity` — docs/API_CONTRACTS.md
// "GET /auth/me/activity". Matches backend/app/schemas/audit.py exactly.

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
}
