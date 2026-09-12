from pydantic import BaseModel, Field, field_validator

from app.schemas.code import CodeIdentity, CodeVariant, validate_code
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
