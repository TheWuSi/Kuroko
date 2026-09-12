from pydantic import BaseModel, Field, field_validator

from app.utils.magnet_parser import clean_magnet
from app.utils.paths import normalize_path


class MagnetParseRequest(BaseModel):
    magnet_links: list[str] = Field(min_length=1, max_length=100)

    @field_validator("magnet_links")
    @classmethod
    def validate_links(cls, links: list[str]) -> list[str]:
        if any(len(link) > 8192 for link in links):
            raise ValueError("磁力链接过长")
        for link in links:
            clean_magnet(link)
        return links


class DownloadRequest(BaseModel):
    magnet: str = Field(min_length=1, max_length=8192)
    code: str = Field(min_length=1, max_length=64)
    force: bool = False
    target_group: str | int | None = None
    target_path: str | None = Field(None, max_length=1024)
    # 兼容旧客户端字段，调度所需体积仍由后端向元数据服务核实。
    total_size: int = Field(0, ge=0, le=2**63 - 1)

    @field_validator("target_path")
    @classmethod
    def validate_target_path(cls, value: str | None) -> str | None:
        return normalize_path(value) if value is not None else None

    @field_validator("target_group")
    @classmethod
    def validate_target_group(cls, value: str | int | None) -> str | int | None:
        if isinstance(value, int) and value <= 0:
            raise ValueError("存储分组 ID 必须大于零")
        if isinstance(value, str) and (not value.strip() or len(value) > 100):
            raise ValueError("存储分组名称无效")
        return value

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = value.strip()
        if not value or "/" in value or "\\" in value or ".." in value or any(ord(char) < 32 for char in value):
            raise ValueError("番号格式无效")
        return value[:64]

    @field_validator("magnet")
    @classmethod
    def validate_magnet(cls, value: str) -> str:
        return clean_magnet(value)


class BatchDownloadRequest(BaseModel):
    tasks: list[DownloadRequest] = Field(min_length=1, max_length=100)
