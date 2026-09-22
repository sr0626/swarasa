// Shared reopen-request status pill — same pattern as
// components/claim/ClaimStatusBadge.tsx, one file per admin-review flow's
// status enum rather than a shared generic component (matches this
// codebase's existing convention).
import type { ReopenRequestStatus } from "@/types/locationReopen";

const STATUS_COPY: Record<ReopenRequestStatus, string> = {
  pending_review: "Pending Review",
  approved: "Approved",
  rejected: "Rejected",
};

export default function ReopenRequestStatusBadge({ status }: { status: ReopenRequestStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center rounded-brand-pill bg-brand-success-bg px-2.5 py-1 text-xs font-semibold text-brand-success">
        {STATUS_COPY.approved}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center rounded-brand-pill bg-brand-closed-bg px-2.5 py-1 text-xs font-semibold text-brand-closed">
        {STATUS_COPY.rejected}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-brand-pill bg-brand-chip px-2.5 py-1 text-xs font-semibold text-brand-chip-ink">
      {STATUS_COPY.pending_review}
    </span>
  );
}
