import pytest

from app.core.security import hash_password, verify_password
from app.utils.code_extractor import extract_code
from app.utils.magnet_parser import clean_magnet


def test_password_hash_round_trip() -> None:
    encoded = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong", encoded)


def test_magnet_cleaner_keeps_only_identity_fields() -> None:
    cleaned = clean_magnet("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef&dn=ABC-123&tr=https://tracker.invalid")
    assert cleaned.startswith("magnet:?")
    assert "xt=urn%3Abtih%3A0123456789abcdef0123456789abcdef" in cleaned
    assert "tr=" not in cleaned


def test_magnet_cleaner_rejects_invalid_hash() -> None:
    with pytest.raises(ValueError):
        clean_magnet("magnet:?xt=urn:btih:not-a-hash")


def test_code_extractor_normalizes_separator() -> None:
    assert extract_code("release abc_123 1080p") == "ABC-123"
    assert extract_code("no media code") is None
