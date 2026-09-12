from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

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


class StorageIgnoreRequest(BaseModel):
    ignored: bool


class StorageMemberRequest(BaseModel):
    storage_id: int = Field(ge=1)
    download_path: str = Field(min_length=1, max_length=1024)
    archive_paths: list[str] = Field(default_factory=list, max_length=20)

    _download = field_validator("download_path")(normalize_path)
    _archives = field_validator("archive_paths")(clean_paths)


class StorageGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    members: list[StorageMemberRequest] | None = Field(default=None, min_length=1, max_length=100)
    storage_paths: list[str] | None = Field(default=None, min_length=1, max_length=100)

    _paths = field_validator("storage_paths")(clean_paths)
    _name = field_validator("name")(clean_group_name)

    @model_validator(mode="after")
    def require_members(self):
        if (self.members is None) == (self.storage_paths is None):
            raise ValueError("请提供存储成员，或兼容的旧目录列表，二者不可同时提交")
        if self.members and len({member.storage_id for member in self.members}) != len(self.members):
            raise ValueError("同一分组不可重复选择存储节点")
        return self


class StorageGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    members: list[StorageMemberRequest] | None = Field(default=None, min_length=1, max_length=100)
    storage_paths: list[str] | None = Field(default=None, min_length=1, max_length=100)

    _paths = field_validator("storage_paths")(clean_paths)
    _name = field_validator("name")(clean_group_name)

    @model_validator(mode="after")
    def check_members(self):
        if self.members is not None and self.storage_paths is not None:
            raise ValueError("存储成员与旧目录列表不可同时提交")
        if self.members and len({member.storage_id for member in self.members}) != len(self.members):
            raise ValueError("同一分组不可重复选择存储节点")
        return self


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
