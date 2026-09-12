"""系统配置持久化和脱敏。"""

import json
from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from app.models.config import SystemConfig
from app.core.config import get_settings

DEFAULTS: dict[str, Any] = {
    "openlist": {"base_url": "", "auth_type": "token", "username": "", "password": "", "token": ""},
    "filter": {"allowed_extensions": [".mp4", ".mkv", ".avi", ".ts", ".wmv"], "min_file_size_mb": 100, "blacklist_patterns": [], "code_patterns": []},
    "bt_parser": {"service_url": "", "token": "", "timeout_seconds": 45},
    "probe_paths": [],
}


def _get_raw(db: Session, key: str) -> Any:
    row = db.query(SystemConfig).filter(SystemConfig.key == key).one_or_none()
    if row:
        try:
            value = json.loads(row.value)
            if isinstance(DEFAULTS[key], dict) and isinstance(value, dict):
                return {**deepcopy(DEFAULTS[key]), **value}
            return value if isinstance(value, list) and isinstance(DEFAULTS[key], list) else deepcopy(DEFAULTS[key])
        except (TypeError, ValueError):
            return deepcopy(DEFAULTS[key])
    defaults = deepcopy(DEFAULTS[key])
    # 环境变量只作为首次默认值，数据库中已有配置始终优先，避免启动时覆盖真实参数。
    settings = get_settings()
    if key == "openlist" and settings.openlist_base_url:
        defaults["base_url"] = settings.openlist_base_url
    if key == "bt_parser" and settings.bt_parser_service_url:
        defaults["service_url"] = settings.bt_parser_service_url
    return defaults


def get_config(db: Session, *, masked: bool = True) -> dict[str, Any]:
    data = {key: _get_raw(db, key) for key in DEFAULTS}
    if masked:
        for section, fields in (("openlist", ("password", "token")), ("bt_parser", ("token",))):
            for field in fields:
                value = data[section].get(field, "")
                data[section][field] = "****" if value else ""
    return data


def merge_section(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = {**current, **patch}
    for field in ("password", "token"):
        previous = current.get(field) or ""
        legacy_mask = f"{previous[:2]}****{previous[-2:]}" if len(previous) > 4 else "****"
        if patch.get(field) in {"****", legacy_mask}:
            merged[field] = previous
    return merged


def update_config(db: Session, patch: dict[str, Any]) -> dict[str, Any]:
    current = get_config(db, masked=False)
    for section, value in patch.items():
        if value is None:
            continue
        value = dict(value) if hasattr(value, "items") else value
        if isinstance(value, dict):
            current[section] = merge_section(current.get(section, {}), value)
        else:
            current[section] = value
        row = db.query(SystemConfig).filter(SystemConfig.key == section).one_or_none()
        if row is None:
            row = SystemConfig(key=section, value=json.dumps(current[section], ensure_ascii=False))
            db.add(row)
        else:
            row.value = json.dumps(current[section], ensure_ascii=False)
    db.commit()
    return get_config(db)
