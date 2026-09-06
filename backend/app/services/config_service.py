"""系统配置持久化和脱敏。"""

import json
from copy import deepcopy
from typing import Any

from sqlalchemy.orm import Session

from app.models.config import SystemConfig

DEFAULTS: dict[str, Any] = {
    "openlist": {"base_url": "", "auth_type": "token", "username": "", "password": "", "token": ""},
    "filter": {"allowed_extensions": [".mp4", ".mkv", ".avi", ".ts", ".wmv"], "min_file_size_mb": 100, "blacklist_patterns": []},
    "bt_parser": {"service_url": "", "token": ""},
    "probe_paths": [],
}


def _get_raw(db: Session, key: str) -> Any:
    row = db.query(SystemConfig).filter(SystemConfig.key == key).one_or_none()
    return json.loads(row.value) if row else deepcopy(DEFAULTS[key])


def get_config(db: Session, *, masked: bool = True) -> dict[str, Any]:
    data = {key: _get_raw(db, key) for key in DEFAULTS}
    if masked:
        for section, fields in (("openlist", ("password", "token")), ("bt_parser", ("token",))):
            for field in fields:
                value = data[section].get(field, "")
                data[section][field] = "" if not value else f"{value[:2]}****{value[-2:]}" if len(value) > 4 else "****"
    return data


def update_config(db: Session, patch: dict[str, Any]) -> dict[str, Any]:
    current = get_config(db, masked=False)
    for section, value in patch.items():
        if value is None:
            continue
        value = dict(value) if hasattr(value, "items") else value
        if isinstance(value, dict):
            merged = {**current.get(section, {}), **value}
            for secret_field in ("password", "token"):
                if merged.get(secret_field, "").startswith("**") or "****" in merged.get(secret_field, ""):
                    merged[secret_field] = current.get(section, {}).get(secret_field, "")
            current[section] = merged
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
