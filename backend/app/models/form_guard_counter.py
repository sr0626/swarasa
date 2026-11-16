"""form_guard_counter -- tiny bucketed counters for the form guard
(docs/API_CONTRACTS.md "Form guard", docs/DATA_MODEL.md).

One row per (form, scope, window) counter. The bucket is part of the key
itself (`g:report:482910` = global counter for the report form in hour bucket
482910), so there is exactly one row per live counter and the atomic upsert
(`INSERT ... ON CONFLICT (counter_key) DO UPDATE SET n = n + 1 RETURNING n`)
needs no composite key. Single-use form-token nonces live here too
(`n:<nonce>`, n > 1 means replay).

PRIVACY BY CONSTRUCTION: keys contain only a form name, a window number and a
salted, truncated HASH of a client/user key -- never an IP address, email or
Cognito sub. Rows are short-lived: `expires_at` (epoch seconds) is set to the
end of the window (nonces: token max age) and an opportunistic purge in
`form_guard_service` deletes expired rows (no cron). No audit_log entry (not
a business record), no CCPA entry (no personal data).
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FormGuardCounter(Base):
    __tablename__ = "form_guard_counter"

    counter_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    n: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False)

    __table_args__ = (Index("ix_form_guard_counter_expires_at", "expires_at"),)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<FormGuardCounter key={self.counter_key!r} n={self.n}>"
