from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=256)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("用户名不能为空")
        return value


class TokenData(BaseModel):
    token: str
    token_type: str = "Bearer"
    expires_at: datetime


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    created_at: datetime


class BootstrapStatus(BaseModel):
    initialized: bool
