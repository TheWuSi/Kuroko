import re
from typing import Any

from sqlalchemy.orm import Session

from app.services.config_service import get_config
from app.services.library_service import duplicate_decision
from app.services.magnet_metadata_client import MagnetMetadataApiClient
from app.utils.code_extractor import extract_code, extract_variant
from app.utils.magnet_parser import clean_magnet, magnet_display_name


def filter_files(
    files: list[dict[str, Any]], config: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rules = config["filter"]
    allowed = {str(item).lower() for item in rules.get("allowed_extensions", [])}
    try:
        minimum = max(0, int(rules.get("min_file_size_mb", 100))) * 1024 * 1024
    except (TypeError, ValueError):
        minimum = 100 * 1024 * 1024
    patterns = []
    for expression in rules.get("blacklist_patterns", []):
        try:
            patterns.append(re.compile(str(expression)[:256], re.IGNORECASE))
        except re.error:
            continue
    valid, rejected = [], []
    for raw in files:
        name = str(raw.get("name") or raw.get("path") or "")
        try:
            size = max(0, int(raw.get("size") or raw.get("length") or 0))
        except (TypeError, ValueError):
            size = 0
        reason = None
        if not any(name.lower().endswith(ext) for ext in allowed):
            reason = "extension"
        elif size < minimum:
            reason = "size"
        elif any(pattern.search(name) for pattern in patterns):
            reason = "blacklist_pattern"
        item = {"name": name, "size": size, "filtered": bool(reason)}
        if reason:
            item["filter_reason"] = reason
            rejected.append(item)
        else:
            valid.append(item)
    return valid, rejected


def metadata_variant(metadata: dict[str, Any], code: str, magnet: str) -> str:
    names = [str(item.get("name") or item.get("path") or "") for item in metadata.get("files", [])]
    names.extend([metadata.get("name") or "", magnet_display_name(magnet)])
    return next((variant for name in names if (variant := extract_variant(name, code)) != "original"), "original")


def parse_magnets(
    db: Session,
    links: list[str],
    *,
    target_group: str | int | None = None,
    target_path: str | None = None,
) -> list[dict[str, Any]]:
    config = get_config(db, masked=False)
    parser = MagnetMetadataApiClient(
        config["bt_parser"].get("service_url", ""),
        config["bt_parser"].get("token", ""),
        config["bt_parser"].get("timeout_seconds", 45),
    )
    try:
        results = []
        for original in links:
            cleaned = clean_magnet(original)
            dn_code = extract_code(magnet_display_name(cleaned), config["filter"].get("code_patterns", []))
            parsed = parser.parse_with_fallback(cleaned)
            valid, rejected = filter_files(parsed.get("files", []), config)
            verified_code = (
                next(
                    (
                        extract_code(item["name"], config["filter"].get("code_patterns", []))
                        for item in valid
                        if extract_code(item["name"], config["filter"].get("code_patterns", []))
                    ),
                    None,
                )
                or extract_code(parsed.get("name") or "", config["filter"].get("code_patterns", []))
                or dn_code
            )
            variant = (
                metadata_variant({**parsed, "files": valid}, verified_code, cleaned) if verified_code else "original"
            )
            decision = (
                duplicate_decision(
                    db,
                    verified_code,
                    variant,
                    target_group=target_group,
                    target_path=target_path,
                )
                if verified_code
                else {
                    "exists_in_library": False,
                    "duplicate_blocked": False,
                    "duplicate_allowed": False,
                    "existing_location": None,
                }
            )
            results.append(
                {
                    "original_magnet": original,
                    "cleaned_magnet": cleaned,
                    "dn_code": dn_code,
                    "verified_code": verified_code,
                    "variant": variant,
                    "total_files_count": len(valid) + len(rejected),
                    "total_size": parsed["size"],
                    "info_hash": parsed["info_hash"],
                    "files": valid,
                    "filtered_files": rejected,
                    **decision,
                    "metadata_fallback": bool(parsed.get("metadata_fallback") or parsed.get("fallback")),
                    "fallback_reason": parsed.get("fallback_reason"),
                    "metadata_name": parsed.get("name") or None,
                }
            )
        return results
    finally:
        parser.close()
