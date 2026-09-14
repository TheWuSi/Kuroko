from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import success
from app.core.security import create_token, get_current_user, get_refresh_user, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import BootstrapStatus, Credentials, SessionTokens, TokenData, UserOut

router = APIRouter(prefix="/auth", tags=["Auth"])


def session_tokens(user: User) -> dict:
    token, expires = create_token(user)
    refresh_token, refresh_expires = create_token(user, refresh=True)
    return SessionTokens(
        token=token,
        expires_at=expires,
        refresh_token=refresh_token,
        refresh_expires_at=refresh_expires,
    ).model_dump(mode="json")


@router.get("/bootstrap-status")
def bootstrap_status(db: Session = Depends(get_db)):
    return success(BootstrapStatus(initialized=db.query(User).first() is not None).model_dump())


@router.post("/bootstrap")
def bootstrap(payload: Credentials, db: Session = Depends(get_db)):
    if db.query(User).first() is not None:
        raise HTTPException(status_code=409, detail="系统已完成初始化")
    user = User(username=payload.username.strip(), hashed_password=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return success(session_tokens(user))


@router.post("/login")
def login(payload: Credentials, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username.strip()).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    return success(session_tokens(user))


@router.post("/refresh")
def refresh(user: User = Depends(get_refresh_user)):
    token, expires = create_token(user)
    return success(TokenData(token=token, expires_at=expires).model_dump(mode="json"))


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return success(UserOut.model_validate(user, from_attributes=True).model_dump(mode="json"))
