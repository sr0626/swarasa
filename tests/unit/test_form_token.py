"""Unit tests for the signed form token (backend/app/core/form_token.py).
Pure logic: the clock is injected, nothing sleeps."""
from __future__ import annotations

import hmac

from app.core import form_token as ft

KEY = ft.derive_key("unit-test-secret", "token")
NOW = 1_800_000_000


def _verify(token, form="report", now=NOW + 10, key=KEY, min_age=3, max_age=7200):
    return ft.verify_token(token, form, now, key, min_age=min_age, max_age=max_age)


def test_valid_token_in_window_passes_and_exposes_nonce():
    token = ft.issue_token("report", NOW, KEY)
    result = _verify(token)
    assert result.ok and result.reason is None
    assert result.nonce and result.issued_at == NOW


def test_tokens_are_unique_per_issue():
    assert ft.issue_token("report", NOW, KEY) != ft.issue_token("report", NOW, KEY)


def test_age_window_boundaries():
    token = ft.issue_token("report", NOW, KEY)
    assert _verify(token, now=NOW + 2).reason == ft.REASON_TOO_FAST
    assert _verify(token, now=NOW + 3).ok
    assert _verify(token, now=NOW + 7200).ok
    assert _verify(token, now=NOW + 7201).reason == ft.REASON_EXPIRED


def test_token_from_the_future_is_rejected():
    token = ft.issue_token("report", NOW + 500, KEY)
    assert _verify(token, now=NOW).reason == ft.REASON_FUTURE
    # Small skew is "too fast", not forged.
    near = ft.issue_token("report", NOW + 5, KEY)
    assert _verify(near, now=NOW).reason == ft.REASON_TOO_FAST


def test_wrong_form_fails():
    token = ft.issue_token("claim", NOW, KEY)
    assert _verify(token, form="report").reason == ft.REASON_BAD_SIGNATURE


def test_wrong_key_fails():
    token = ft.issue_token("report", NOW, ft.derive_key("another-secret", "token"))
    assert _verify(token).reason == ft.REASON_BAD_SIGNATURE


def test_tampering_with_any_part_fails():
    issued, nonce, sig = ft.issue_token("report", NOW, KEY).split(".")
    older = f"{int(issued) - 100}.{nonce}.{sig}"  # backdate to dodge the min age
    assert _verify(older).reason == ft.REASON_BAD_SIGNATURE
    assert _verify(f"{issued}.{nonce}x.{sig}").reason == ft.REASON_BAD_SIGNATURE
    flipped = sig[:-1] + ("A" if sig[-1] != "A" else "B")
    assert _verify(f"{issued}.{nonce}.{flipped}").reason == ft.REASON_BAD_SIGNATURE


def test_malformed_and_missing():
    for bad in ("", None):
        assert _verify(bad).reason == ft.REASON_MISSING
    for bad in ("abc", "1.2", "a.b.c", "1.2.3.4", "-5.n.s", "12.n.", "x" * 500, "１２.n.s"):
        assert _verify(bad).reason in (ft.REASON_MALFORMED,), bad
    assert _verify("12.n.\ud800").reason in (ft.REASON_MALFORMED, ft.REASON_BAD_SIGNATURE)


def test_signature_comparison_is_constant_time(monkeypatch):
    calls = []
    real = hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(ft.hmac, "compare_digest", spy)
    _verify(ft.issue_token("report", NOW, KEY))
    assert len(calls) == 1


def test_derived_keys_are_domain_separated():
    assert ft.derive_key("s", "token") != ft.derive_key("s", "hash")
    assert ft.derive_key("s", "token") == ft.derive_key("s", "token")
    assert ft.derive_key("s", "token") != ft.derive_key("t", "token")
