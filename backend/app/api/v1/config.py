from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import SecretStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import ApiError, success
from app.core.security import get_current_user
from app.schemas.config import BtParserConfig, ConfigPatch, ConnectionTestRequest
from app.services.config_service import get_config, merge_section, update_config
from app.services.magnet_metadata_client import MagnetMetadataApiClient, MagnetMetadataError
from app.services.openlist_client import OpenListClient, OpenListError

router = APIRouter(prefix="/config", tags=["Config"], dependencies=[Depends(get_current_user)])


def _plain_secrets(value: Any) -> Any:
    """将 Pydantic SecretStr 转为服务层可持久化的值，避免把掩码写入数据库。"""
    if isinstance(value, SecretStr):
        return value.get_secret_value()
    if isinstance(value, dict):
        return {key: _plain_secrets(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain_secrets(item) for item in value]
    return value


@router.get("")
def read_config(db: Session = Depends(get_db)):
    return success(get_config(db))


@router.put("")
def write_config(payload: ConfigPatch, db: Session = Depends(get_db)):
    return success(update_config(db, _plain_secrets(payload.model_dump(exclude_none=True, exclude_unset=True))))


@router.post("/test-connection")
def test_connection(payload: ConnectionTestRequest | None = None, db: Session = Depends(get_db)):
    current = get_config(db, masked=False)["openlist"]
    patch = _plain_secrets(payload.model_dump(exclude_none=True, exclude_unset=True)) if payload else {}
    config = merge_section(current, patch)
    try:
        with OpenListClient(config) as client:
            return success(client.test_connection())
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/test-bt-parser")
def test_bt_parser(payload: BtParserConfig | None = None, db: Session = Depends(get_db)):
    current = get_config(db, masked=False)["bt_parser"]
    patch = _plain_secrets(payload.model_dump(exclude_none=True, exclude_unset=True)) if payload else {}
    config = merge_section(current, patch)
    try:
        with MagnetMetadataApiClient(config["service_url"], config["token"], config["timeout_seconds"]) as client:
            return success(client.test_connection())
    except MagnetMetadataError as exc:
        raise ApiError(502, 50202, str(exc)) from exc
