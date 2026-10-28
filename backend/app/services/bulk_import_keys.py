"""Duplicate-detection keys and the duplicate index for the admin bulk
import (docs/DECISIONS.md proposal; docs/API_CONTRACTS.md "Admin bulk
listing import"). Pure: no DB, no network -- the service loads existing
listings and feeds them in, so the SAME rule judges (a) a row against the
listings already in the system and (b) a row against earlier rows of the
same upload.

Keys (all derived from already-cleaned values):
  name_key  lower-cased name, accents removed, every non-alphanumeric
            character dropped  ("Dera Grill!" == "dera  grill")
  addr_key  normalized street + ZIP5. Street: lower-cased, punctuation
            removed, unit designators ("Ste 100", "#5", "Apt 2") dropped,
            common street/direction words abbreviated ("Street"->"st",
            "North"->"n") then joined, so "100 North Main Street, Ste 5"
            and "100 N. Main St" match. ZIP+4 is reduced to ZIP5.
  phone     the E.164 form (`+1XXXXXXXXXX`) from the shared phone rule.

Verdicts (first match by strength, then by order):
  DEFINITE ("duplicate" -- the row is skipped, never written):
     * same name_key AND same addr_key, or
     * same name_key AND same phone  (same restaurant, address typed
       differently).
  POSSIBLE ("warning" -- written only if the admin opts in):
     * same addr_key, different name (a rename, or a second tenant at the
       same address), or
     * same phone only (name and address both differ).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

DEFINITE = "definite"
POSSIBLE = "possible"

_STREET_WORDS = {
    "street": "st", "avenue": "ave", "boulevard": "blvd", "road": "rd", "drive": "dr",
    "lane": "ln", "highway": "hwy", "parkway": "pkwy", "expressway": "expy",
    "freeway": "fwy", "court": "ct", "circle": "cir", "place": "pl", "trail": "trl",
    "square": "sq", "terrace": "ter",
    "north": "n", "south": "s", "east": "e", "west": "w",
    "northeast": "ne", "northwest": "nw", "southeast": "se", "southwest": "sw",
}
_UNIT_WORDS = frozenset({"ste", "suite", "unit", "apt", "apartment", "bldg", "building", "fl", "floor", "rm", "room"})


def name_key(name: str) -> str:
    folded = unicodedata.normalize("NFKD", name).casefold()
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    return re.sub(r"[^0-9a-z]+", "", folded)


def zip5(postal_code: str) -> str:
    match = re.match(r"\s*(\d{5})", postal_code or "")
    return match.group(1) if match else ""


def address_key(address_line1: str, postal_code: str) -> str:
    text = unicodedata.normalize("NFKD", address_line1).casefold()
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"#\s*\S+", " ", text)  # "#135", "# 5"
    text = re.sub(r"[^0-9a-z]+", " ", text)
    tokens = text.split()
    kept: list[str] = []
    skip_next = False
    for token in tokens:
        if skip_next:
            skip_next = False
            continue
        if token in _UNIT_WORDS:
            skip_next = True  # drop the unit number/letter that follows
            continue
        kept.append(_STREET_WORDS.get(token, token))
    return "".join(kept) + "|" + zip5(postal_code)


@dataclass(frozen=True)
class DupEntry:
    """One thing a row can duplicate: an existing listing or an earlier row."""

    name_key: str
    addr_key: str
    phone: str | None
    label: str  # human text: 'row 7' / 'existing listing "X" (ID 12)'
    row_number: int | None = None  # set for earlier rows of the upload
    listing_id: int | None = None  # set for existing listings


@dataclass(frozen=True)
class DupMatch:
    level: str  # DEFINITE | POSSIBLE
    reason: str  # 'same name and address' | ...
    entry: DupEntry


class DuplicateIndex:
    """Linear scan is fine: <= a few thousand entries per request, and the
    candidate set is pre-filtered by ZIP/phone in SQL."""

    def __init__(self) -> None:
        self._entries: list[DupEntry] = []

    def add(self, entry: DupEntry) -> None:
        self._entries.append(entry)

    def check(self, nkey: str, akey: str, phone: str | None) -> DupMatch | None:
        possible: DupMatch | None = None
        for entry in self._entries:
            same_name = bool(nkey) and nkey == entry.name_key
            same_addr = bool(akey) and akey == entry.addr_key
            same_phone = phone is not None and phone == entry.phone
            if same_name and same_addr:
                return DupMatch(DEFINITE, "same name and address", entry)
            if same_name and same_phone:
                return DupMatch(DEFINITE, "same name and phone number", entry)
            if possible is None:
                if same_addr:
                    possible = DupMatch(POSSIBLE, "same address, different name", entry)
                elif same_phone:
                    possible = DupMatch(POSSIBLE, "same phone number, different name and address", entry)
        return possible
