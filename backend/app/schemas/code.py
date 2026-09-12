from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.utils.code_extractor import canonical_code

CodeVariant = Literal["original", "C", "UC", "U"]


def validate_code(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 64 or "/" in value or "\\" in value or ".." in value:
        raise ValueError("番号格式无效")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("番号包含控制字符")
    return canonical_code(value)


class CodeIdentity(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    variant: CodeVariant = "original"

    _code = field_validator("code")(validate_code)


class DuplicateAllowanceRequest(BaseModel):
    group_id: int = Field(ge=1)
    code: str = Field(min_length=1, max_length=64)
    variants: list[CodeVariant] = Field(min_length=2, max_length=4)

    _code = field_validator("code")(validate_code)

    @field_validator("variants")
    @classmethod
    def unique_variants(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("放行组合必须包含不同版本，同一版本重复仍需处理")
        return sorted(value)


class ScanRequest(BaseModel):
    group_id: int | None = Field(default=None, ge=1)


class CodeOut(BaseModel):
    code: str
    storage_path: str
    file_name: str
    file_size: int
    discovered_at: str


class ScanJobOut(BaseModel):
    task_id: str
    status: str
    scanned_files: int
    new_codes_found: int
    current_path: str | None
    progress_percent: float
    started_at: str
    completed_at: str | None
    error_message: str | None
