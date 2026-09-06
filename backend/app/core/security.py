"""JWT 和密码校验。"""

from datetime import UTC, datetime, timedelta
import base64
import hashlib
import hmac
import os
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.user import User

ALGORITHM = "HS256"
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 240_000)
    return "pbkdf2_sha256$240000$%s$%s" % (
        base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(digest).decode(),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, rounds, salt_text, digest_text = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(digest_text.encode())
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(rounds))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_token(user: User, *, refresh: bool = False) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(UTC)
    expires = now + (timedelta(days=settings.refresh_token_days) if refresh else timedelta(minutes=settings.access_token_minutes))
    payload: dict[str, Any] = {"sub": str(user.id), "username": user.username, "type": "refresh" if refresh else "access", "exp": expires}
    return jwt.encode(payload, settings.secret_key.get_secret_value(), algorithm=ALGORITHM), expires


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少 Bearer Token")
    try:
        payload = jwt.decode(credentials.credentials, get_settings().secret_key.get_secret_value(), algorithms=[ALGORITHM])
        if payload.get("type") != "access" or not payload.get("sub"):
            raise ValueError("invalid token type")
        user = db.get(User, int(payload["sub"]))
    except (JWTError, ValueError, TypeError):
        user = None
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 无效或已过期")
    return user


def get_refresh_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少 Bearer Token")
    try:
        payload = jwt.decode(credentials.credentials, get_settings().secret_key.get_secret_value(), algorithms=[ALGORITHM])
        if payload.get("type") != "refresh" or not payload.get("sub"):
            raise ValueError("invalid refresh token")
        user = db.get(User, int(payload["sub"]))
    except (JWTError, ValueError, TypeError):
        user = None
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh Token 无效或已过期")
    return user
