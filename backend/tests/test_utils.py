import pytest

from app.core.security import hash_password, verify_password
from app.utils.code_extractor import extract_code, extract_variant
from app.utils.magnet_parser import clean_magnet


def test_password_hash_round_trip() -> None:
    encoded = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong", encoded)


def test_magnet_cleaner_keeps_only_identity_fields() -> None:
    cleaned = clean_magnet(
        "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=ABC-123&tr=https://tracker.invalid"
    )
    assert cleaned.startswith("magnet:?")
    assert "xt=urn:btih:0123456789abcdef0123456789abcdef01234567" in cleaned
    assert "tr=" not in cleaned


def test_magnet_cleaner_repairs_encoded_urn_and_preserves_display_name() -> None:
    from urllib.parse import parse_qs, urlsplit

    original = "magnet:?dn=%E4%B8%AD%E6%96%87%26tr%3Dtest&xt=urn%3Abtih%3A" + "A" * 40
    cleaned = clean_magnet(original)
    assert cleaned.startswith("magnet:?xt=urn:btih:" + "a" * 40)
    assert "urn%3A" not in cleaned
    assert parse_qs(urlsplit(cleaned).query)["dn"] == ["中文&tr=test"]
    assert clean_magnet(cleaned) == cleaned


def test_magnet_cleaner_rejects_invalid_hash() -> None:
    with pytest.raises(ValueError):
        clean_magnet("magnet:?xt=urn:btih:not-a-hash")


def test_magnet_cleaner_normalizes_base32_hash() -> None:
    assert "0" * 40 in clean_magnet("magnet:?xt=urn:btih:" + "A" * 32)


@pytest.mark.parametrize("invalid", ["a" * 33, "g" * 40, "1" * 32])
def test_magnet_cleaner_rejects_invalid_encoding(invalid) -> None:
    with pytest.raises(ValueError):
        clean_magnet("magnet:?xt=urn:btih:" + invalid)


def test_code_extractor_normalizes_separator() -> None:
    assert extract_code("release abc_123 1080p") == "ABC-123"
    assert extract_code("no media code") is None


def test_code_extractor_supports_catalog_variants() -> None:
    assert extract_code("T28-001.mp4") == "T28-001"
    assert extract_code("FC2_PPv_123.mkv") == "FC2-PPV-123"
    assert extract_code("HEYZO-9999") == "HEYZO-9999"
    assert extract_code("作品 12345678.mp4") == "12345678"


@pytest.mark.parametrize("name", ["FC2-1234567", "FC2_PPv_1234567", "fc21234567", "FC2PPV1234567"])
def test_fc2_aliases_share_one_identity(name) -> None:
    assert extract_code(name + "-UC.mp4") == "FC2-PPV-1234567"
    assert extract_variant(name + "-UC.mp4", "FC2-PPV-1234567") == "UC"


@pytest.mark.parametrize(
    "suffix,expected", [("-C", "C"), ("-UC", "UC"), ("_u", "U"), ("-CUT", "original"), ("", "original")]
)
def test_version_suffix_is_separate_from_code(suffix, expected) -> None:
    assert extract_code("ABC-123" + suffix + ".mkv") == "ABC-123"
    assert extract_variant("ABC-123" + suffix + ".mkv", "ABC-123") == expected


def test_variant_prefers_file_over_parent_and_resolution_is_not_a_code() -> None:
    assert extract_variant("/ABC-123-C/ABC-123-UC.mkv", "ABC-123") == "UC"
    assert extract_variant("/12345678/12345678-U.mkv", "12345678") == "U"
    assert extract_code("video-1080p.mkv") is None


@pytest.mark.parametrize(
    "name,expected",
    [
        ("300MIUM-777", "300MIUM-777"),
        ("300MIUM-777.mp4", "300MIUM-777"),
        ("[ThZu.Cc]300MIUM-777", "300MIUM-777"),
        ("300MIUM_777_1080p", "300MIUM-777"),
        ("259LUXU-1234-C.mkv", "259LUXU-1234"),
        ("200GANA-2345", "200GANA-2345"),
    ],
)
def test_code_extractor_supports_digit_letter_prefixes(name, expected) -> None:
    # 前缀本身同时含数字与字母，整体作为番号身份，不在前缀内部再插入分隔符。
    assert extract_code(name) == expected


@pytest.mark.parametrize("name", ["SIRO-4321", "ABC-123", "FC2-PPV-1234567", "T28-001", "HEYZO-9999"])
def test_digit_letter_rule_does_not_change_existing_codes(name) -> None:
    assert extract_code(name) == name
