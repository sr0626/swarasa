"""`GET /admin/registered-user-count` — see docs/API_CONTRACTS.md "Admin
(bulk operations)" section. Its own schema module (not folded into
`admin_notifications.py`) since it's an unrelated data source (Cognito
group membership, not a local-DB aggregate) and a companion admin
analytics/overview page is expected to grow this file with sibling stats
later.
"""
from __future__ import annotations

from pydantic import BaseModel


class RegisteredUserCountResponse(BaseModel):
    count: int
    # Named explicitly rather than assumed, since "registered users" is
    # ambiguous between "everyone in the pool" and "the registered_user
    # role" — see the router docstring for the reasoning.
    group: str = "registered_user"
