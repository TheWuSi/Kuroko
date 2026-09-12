from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.utils.paths import normalize_path


def clean_paths(paths: list[str]) -> list[str]:
    normalized = []
    for value in paths:
        normalized.append(normalize_path(value.strip()))
    return list(dict.fromkeys(normalized))


class SpaceOverrideRequest(BaseModel):
    total_space_bytes: int = Field(gt=0, le=2**63 - 1)


class StorageGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    storage_paths: list[str] = Field(min_length=1, max_length=100)

    _paths = field_validator("storage_paths")(clean_paths)


class StorageGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    storage_paths: list[str] | None = Field(default=None, min_length=1, max_length=100)

    _paths = field_validator("storage_paths")(clean_paths)


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
