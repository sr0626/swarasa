"""Phase 1 SQLAlchemy models — owned by the Architect agent.

Importing this package registers every model class on `Base.metadata`,
which is what Alembic's `migrations/env.py` relies on for autogenerate.
Import order follows FK dependency order (parents before children) —
not required by SQLAlchemy itself, but keeps this list readable as a
map of the ownership hierarchy.

`RestaurantPhoto` and `ClaimRequest` were added in a follow-up task
(migration `20260912_0002_...`) to close two gaps flagged by the
original Phase 1 pass — the gallery-photo table (`docs/DATA_MODEL.md`
"Open items") and the claim-flow backing table
(`docs/API_CONTRACTS.md` "Claim flow"). The original 11 entities above
them are unchanged.
"""
from app.models.owner_account import OwnerAccount
from app.models.restaurant_brand import RestaurantBrand
from app.models.restaurant_location import RestaurantLocation
from app.models.restaurant_photo import RestaurantPhoto
from app.models.cuisine_tag import CuisineTag
from app.models.restaurant_cuisine import RestaurantCuisine
from app.models.location_manager import LocationManager
from app.models.user_follow import UserFollow
from app.models.claim_request import ClaimRequest
from app.models.listing_report import ListingReport
from app.models.data_deletion_request import DataDeletionRequest
from app.models.audit_log import AuditLog
from app.models.platform_pricing import PlatformPricing
from app.models.platform_config import PlatformConfig
from app.models.admin_free_offer import AdminFreeOffer
from app.models.restaurant_hours import RestaurantHours
from app.models.user_profile import UserProfile

__all__ = [
    "OwnerAccount",
    "RestaurantBrand",
    "RestaurantLocation",
    "RestaurantPhoto",
    "CuisineTag",
    "RestaurantCuisine",
    "LocationManager",
    "UserFollow",
    "ClaimRequest",
    "ListingReport",
    "DataDeletionRequest",
    "AuditLog",
    "PlatformPricing",
    "PlatformConfig",
    "AdminFreeOffer",
    "RestaurantHours",
    "UserProfile",
]
