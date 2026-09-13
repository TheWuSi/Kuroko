from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

from app.utils.code_extractor import canonical_code

CodeVariant = Literal["original", "C", "UC", "U"]
PartNumber = Annotated[int, Field(ge=0, le=9999, strict=True)]


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
    part_numbers: list[PartNumber] | None = Field(default=None, min_length=1, max_length=1000)

    _code = field_validator("code")(validate_code)

    @field_validator("part_numbers")
    @classmethod
    def normalize_parts(cls, value: list[int] | None) -> list[int] | None:
        return sorted(set(value)) if value is not None else None


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
    part_number: int | None
    storage_path: str
    file_name: str
    file_size: int
    discovered_at: str


class ScanJobOut(BaseModel):
    task_id: str
    status: str
    scanned_files: int
    scanned_dirs: int
    total_roots: int
    completed_roots: int
    scan_paths: list[str]
    cancel_requested: bool
    new_codes_found: int
    current_path: str | None
    progress_percent: float
    started_at: str
    completed_at: str | None
    error_message: str | None
