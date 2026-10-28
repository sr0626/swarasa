// Types for GET /admin/audit-log, matching docs/API_CONTRACTS.md
// "GET /admin/audit-log".

/** A JSON value from an audit snapshot. Always rendered as escaped text. */
export type AuditJson =
  | string
  | number
  | boolean
  | null
  | AuditJson[]
  | { [key: string]: AuditJson };

export interface AuditLogEntry {
  id: number;
  table_name: string;
  record_id: number;
  action: string;
  actor_id: string;
  actor_role: string;
  actor_email: string | null;
  actor_label: string;
  summary: string;
  old_val: { [key: string]: AuditJson } | null;
  new_val: { [key: string]: AuditJson } | null;
  /** ISO timestamp (UTC). */
  created_at: string;
}

export interface AuditLogResponse {
  results: AuditLogEntry[];
  page: number;
  page_size: number;
  total: number;
  /** Every distinct table_name (not narrowed by the filters). */
  entity_types: string[];
  email_lookup_degraded: boolean;
}

export interface AuditLogParams {
  page?: number;
  page_size?: number;
  entity?: string;
  action?: string;
  actor?: string;
  /** YYYY-MM-DD (UTC), inclusive. */
  date_from?: string;
  date_to?: string;
}
