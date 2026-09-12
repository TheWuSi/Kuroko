import re
from typing import Any

from sqlalchemy.orm import Session

from app.models.code import CodeRecord
from app.services.magnet_metadata_client import MagnetMetadataApiClient
from app.services.config_service import get_config
from app.utils.code_extractor import extract_code
from app.utils.magnet_parser import clean_magnet


def filter_files(files: list[dict[str, Any]], config: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
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


def parse_magnets(db: Session, links: list[str]) -> list[dict[str, Any]]:
    config = get_config(db, masked=False)
    parser = MagnetMetadataApiClient(
        config["bt_parser"].get("service_url", ""),
        config["bt_parser"].get("token", ""),
        config["bt_parser"].get("timeout_seconds", 45),
    )
    results = []
    for original in links:
        cleaned = clean_magnet(original)
        dn_code = extract_code(cleaned, config["filter"].get("code_patterns", []))
        parsed = parser.parse_with_fallback(cleaned)
        valid, rejected = filter_files(parsed.get("files", []), config)
        verified_code = next(
            (extract_code(item["name"], config["filter"].get("code_patterns", [])) for item in valid if extract_code(item["name"], config["filter"].get("code_patterns", []))),
            None,
        ) or dn_code
        existing = db.query(CodeRecord).filter(CodeRecord.code == verified_code).first() if verified_code else None
        results.append(
            {
                "original_magnet": original,
                "cleaned_magnet": cleaned,
                "dn_code": dn_code,
                "verified_code": verified_code,
                "total_files_count": len(valid),
                "files": valid,
                "filtered_files": rejected,
                "exists_in_library": existing is not None,
                "existing_location": f"{existing.storage_path}/{existing.file_name}" if existing else None,
                "metadata_fallback": bool(parsed.get("metadata_fallback") or parsed.get("fallback")),
                "fallback_reason": parsed.get("fallback_reason"),
                "metadata_name": parsed.get("name") or None,
            }
        )
    return results
