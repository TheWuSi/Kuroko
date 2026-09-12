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


def test_code_extractor_supports_catalog_variants() -> None:
    assert extract_code("T28-001.mp4") == "T28-001"
    assert extract_code("FC2_PPv_123.mkv") == "FC2-PPV-123"
    assert extract_code("HEYZO-9999") == "HEYZO-9999"
    assert extract_code("作品 12345678.mp4") == "12345678"
