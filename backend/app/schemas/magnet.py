from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StrictInt, field_validator

from app.schemas.code import CodeIdentity, CodeVariant, validate_code
from app.utils.code_extractor import canonical_code
from app.utils.magnet_parser import clean_magnet
from app.utils.paths import normalize_path


class TargetScope(BaseModel):
    target_group: str | int | None = None
    target_path: str | None = Field(None, max_length=1024)

    @field_validator("target_path")
    @classmethod
    def validate_target_path(cls, value: str | None) -> str | None:
        return normalize_path(value) if value is not None else None

    @field_validator("target_group")
    @classmethod
    def validate_target_group(cls, value: str | int | None) -> str | int | None:
        if isinstance(value, int) and value <= 0:
            raise ValueError("存储分组 ID 必须大于零")
        if isinstance(value, str) and (not value.strip() or len(value) > 100 or any(ord(c) < 32 for c in value)):
            raise ValueError("存储分组名称无效")
        return value


class MagnetParseRequest(TargetScope):
    magnet_links: list[str] = Field(min_length=1, max_length=100)

    @field_validator("magnet_links")
    @classmethod
    def validate_links(cls, links: list[str]) -> list[str]:
        if any(len(link) > 8192 for link in links):
            raise ValueError("磁力链接过长")
        for link in links:
            clean_magnet(link)
        return links


class DuplicateCheckRequest(TargetScope):
    items: list[CodeIdentity] = Field(min_length=1, max_length=100)


class DownloadRequest(TargetScope):
    magnet: str = Field(min_length=1, max_length=8192)
    code: str = Field(min_length=1, max_length=64)
    force: bool = False
    variant: CodeVariant | None = None
    # 兼容旧客户端字段，调度所需体积仍由后端向元数据服务核实。
    total_size: int = Field(0, ge=0, le=2**63 - 1)

    _code = field_validator("code")(validate_code)

    @field_validator("magnet")
    @classmethod
    def validate_magnet(cls, value: str) -> str:
        return clean_magnet(value)


class BatchDownloadRequest(BaseModel):
    tasks: list[DownloadRequest] = Field(min_length=1, max_length=100)


class ParseJobRequest(MagnetParseRequest):
    request_id: UUID


ItemIndex = Annotated[StrictInt, Field(ge=0, le=99)]


class ResumeParseRequest(BaseModel):
    indices: list[ItemIndex] | None = Field(None, min_length=1, max_length=100)
    # 批次收尾默认移除输入框中的重复项；该开关为一次性保留，不改变默认行为。
    keep_duplicates: bool = False


class CorrectItemRequest(BaseModel):
    """手工修正番号：null 回退自动识别，空串表示放弃识别（提交记为 UNKNOWN）。"""

    code: str | None = Field(None, max_length=64)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return ""
        if len(value) > 64 or any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("番号格式无效，请填写 1 至 64 个可见字符")
        return canonical_code(value)


class SubmissionRequest(TargetScope):
    request_id: UUID
    item_indices: list[ItemIndex] = Field(min_length=1, max_length=100)
    force: bool = False

    @field_validator("item_indices")
    @classmethod
    def unique_indices(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("提交条目不可重复")
        return sorted(value)
