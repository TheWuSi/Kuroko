from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.utils.paths import normalize_path


def clean_paths(paths: list[str] | None) -> list[str] | None:
    if paths is None:
        return None
    normalized = []
    for value in paths:
        normalized.append(normalize_path(value.strip()))
    return list(dict.fromkeys(normalized))


def clean_group_name(name: str | None) -> str | None:
    if name is None:
        return None
    name = name.strip()
    if not name or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise ValueError("分组名称不可为空或包含控制字符")
    return name


class SpaceOverrideRequest(BaseModel):
    total_space_bytes: int = Field(gt=0, le=2**63 - 1)


class StorageGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    storage_paths: list[str] = Field(min_length=1, max_length=100)

    _paths = field_validator("storage_paths")(clean_paths)
    _name = field_validator("name")(clean_group_name)


class StorageGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    storage_paths: list[str] | None = Field(default=None, min_length=1, max_length=100)

    _paths = field_validator("storage_paths")(clean_paths)
    _name = field_validator("name")(clean_group_name)


class StorageGroupOut(BaseModel):
    id: int
    name: str
    storage_paths: list[str]
    created_at: datetime
    updated_at: datetime


class StorageOut(BaseModel):
    id: int
    mount_path: str
    driver: str
    status: str
    total_space: int | None
    used_space: int | None
    free_space: int | None
    space_source: str
