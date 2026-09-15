import re
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.orm import Session

from app.services.config_service import get_config
from app.services.library_service import duplicate_decision
from app.services.magnet_metadata_client import MagnetMetadataApiClient
from app.utils.code_extractor import extract_code, extract_media_code, extract_part_number, extract_variant
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


def metadata_parts(metadata: dict[str, Any], code: str, config: dict[str, Any]) -> list[int] | None:
    if not code.startswith("FC2-PPV-") or metadata.get("metadata_fallback") or metadata.get("fallback"):
        return None
    files, _ = filter_files(metadata.get("files", []), config)
    parts = set()
    for file in files:
        path = str(PurePosixPath(metadata.get("name") or "") / file["name"])
        # 文件自身的番号优先，作品目录只为没有番号的文件提供上下文。
        identity = extract_media_code(path, config["filter"].get("code_patterns", []))
        if identity is None:
            return None
        if identity == code:
            parts.add(extract_part_number(path, code))
    return sorted(parts) if parts and len(parts) <= 1000 else None


def public_result(result: dict[str, Any]) -> dict[str, Any]:
    """移除仅供服务端复算使用的内部字段，避免污染 API 响应与数据库摘要。"""
    result.pop("_config", None)
    return result


# 仅服务端使用的字段：不进入 summary，也不出现在 API 响应中。
INTERNAL_FIELDS = frozenset({"files", "filtered_files", "_config", "auto_code"})


def summarize(result: dict[str, Any]) -> dict[str, Any]:
    """生成条目摘要，剔除完整文件清单与服务端内部字段。"""
    return {key: value for key, value in result.items() if key not in INTERNAL_FIELDS}


def resolve_identity(result: dict[str, Any], manual_code: str | None) -> dict[str, Any]:
    """按手工番号覆盖识别结果并重新推导版本与分集。

    manual_code 为 None 表示未指定，沿用自动识别结果（每次都从识别结论重算，
    以便用户清除手工番号后能回到 dn／文件名结果）。空串表示显式放弃识别，
    不再回退到 dn 或文件名，避免"清除"操作被自动结果顶回去。
    """
    if manual_code is None:
        code = result.get("auto_code") or None
    else:
        code = manual_code.strip() or None
    result["verified_code"] = code
    result["manual_code"] = None if manual_code is None else (manual_code.strip() or "")
    if not code:
        result["variant"] = "original"
        result["part_numbers"] = None
        return result
    metadata = {
        "name": result.get("metadata_name") or "",
        "files": result.get("files") or [],
        "metadata_fallback": result.get("metadata_fallback"),
        "fallback": result.get("metadata_fallback"),
    }
    result["variant"] = metadata_variant(metadata, code, result["cleaned_magnet"])
    config = result.get("_config")
    # 分集仅对 FC2 有意义，重新计算需要过滤后的完整文件清单。
    result["part_numbers"] = (
        metadata_parts(metadata, code, config) if config and code.startswith("FC2-PPV-") else None
    )
    return result


def build_parse_result(original: str, parsed: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """纯元数据处理不持有数据库连接，适合长耗时后台解析。"""
    cleaned = clean_magnet(original)
    dn_code = extract_code(magnet_display_name(cleaned), config["filter"].get("code_patterns", []))
    valid, rejected = filter_files(parsed.get("files", []), config)
    verified_code = (
        next(
            (
                identity
                for item in valid
                if (
                    identity := extract_media_code(
                        str(PurePosixPath(parsed.get("name") or "") / item["name"]),
                        config["filter"].get("code_patterns", []),
                    )
                )
            ),
            None,
        )
        or extract_code(parsed.get("name") or "", config["filter"].get("code_patterns", []))
        or dn_code
    )
    variant = metadata_variant({**parsed, "files": valid}, verified_code, cleaned) if verified_code else "original"
    parts = metadata_parts(parsed, verified_code, config) if verified_code else None
    return {
        "original_magnet": original,
        "cleaned_magnet": cleaned,
        "dn_code": dn_code,
        "verified_code": verified_code,
        "variant": variant,
        "part_numbers": parts,
        "total_files_count": len(valid) + len(rejected),
        "total_size": parsed["size"],
        "info_hash": parsed["info_hash"],
        "files": valid,
        "filtered_files": rejected,
        "exists_in_library": False,
        "duplicate_blocked": False,
        "duplicate_allowed": False,
        "existing_location": None,
        "scope_group_ids": [],
        "dedup_scope": "unselected",
        "metadata_fallback": bool(parsed.get("metadata_fallback") or parsed.get("fallback")),
        "fallback_reason": parsed.get("fallback_reason"),
        "metadata_name": parsed.get("name") or None,
        # 手工改番号后需要复用过滤配置重算分集；序列化前会移除该字段。
        "manual_code": None,
        # 保留自动识别结论，用户清除手工番号时据此恢复，无需重新请求元数据。
        "auto_code": verified_code,
        "_config": config,
    }


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
            # 同步接口由单个请求触发，重试次数收敛，避免客户端连接被长时间占用。
            parsed = parser.parse_with_fallback(cleaned, attempts=2)
            result = public_result(build_parse_result(original, parsed, config))
            if result["verified_code"]:
                result.update(
                    duplicate_decision(
                        db,
                        result["verified_code"],
                        result["variant"],
                        part_numbers=result["part_numbers"],
                        target_group=target_group,
                        target_path=target_path,
                    )
                )
            results.append(result)
        return results
    finally:
        parser.close()
