"""Merge the two parallel 0009 revisions into a single head.

`0009_deal` (deals engine, PR #185) and `0009_user_profile_last_seen_at`
(admin registered-users report, PR #184) were authored in parallel branches
off the same parent (`0008_location_status_lifecycle`) and both merged to
`main`, leaving Alembic with two heads. `alembic upgrade head` refuses to
run against multiple heads ("Multiple head revisions"), so neither could
be applied to the real database until reconciled. Same fix as the earlier
0008 reconciliation: an empty merge revision, no schema changes of its own.

Revision id kept short (`alembic_version.version_num` is VARCHAR(32) —
see 0002's header).
"""
from typing import Sequence, Union

revision: str = "0010_merge_0009_heads"
down_revision: Union[str, tuple[str, ...], None] = (
    "0009_deal",
    "0009_user_profile_last_seen_at",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
