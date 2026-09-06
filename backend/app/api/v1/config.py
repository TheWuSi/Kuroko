from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import SecretStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.config import ConfigPatch, ConnectionTestRequest
from app.services.config_service import get_config, update_config
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
    return success(update_config(db, _plain_secrets(payload.model_dump(exclude_none=True))))


@router.post("/test-connection")
def test_connection(payload: ConnectionTestRequest | None = None, db: Session = Depends(get_db)):
    config: dict[str, Any] = _plain_secrets(payload.model_dump(exclude_none=True)) if payload else get_config(db, masked=False)["openlist"]
    try:
        return success(OpenListClient(config).test_connection())
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
