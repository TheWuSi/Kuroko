from pydantic import BaseModel, Field, field_validator


class MagnetParseRequest(BaseModel):
    magnet_links: list[str] = Field(min_length=1, max_length=100)

    @field_validator("magnet_links")
    @classmethod
    def validate_links(cls, links: list[str]) -> list[str]:
        if any(len(link) > 8192 for link in links):
            raise ValueError("磁力链接过长")
        return links


class DownloadRequest(BaseModel):
    magnet: str = Field(min_length=1, max_length=8192)
    code: str = Field(min_length=1, max_length=64)
    force: bool = False
    target_group: str | int | None = None
    total_size: int = Field(0, ge=0)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = value.strip()
        if not value or "/" in value or "\\" in value or ".." in value:
            raise ValueError("番号格式无效")
        return value[:64]

    @field_validator("magnet")
    @classmethod
    def validate_magnet(cls, value: str) -> str:
        value = value.strip()
        if not value.lower().startswith("magnet:?"):
            raise ValueError("必须提供磁力链接")
        return value


class BatchDownloadRequest(BaseModel):
    tasks: list[DownloadRequest] = Field(min_length=1, max_length=100)
