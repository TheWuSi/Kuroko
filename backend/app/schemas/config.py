import re
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, SecretStr, field_validator

from app.utils.paths import normalize_path


def validate_optional_url(value: str, field_name: str) -> str:
    value = value.strip()
    if not value:
        return value
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"{field_name} 必须是有效的 http/https URL") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65535)
        or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise ValueError(f"{field_name} 必须是 http/https URL")
    return value.rstrip("/")


class OpenListConfig(BaseModel):
    base_url: str = Field("", max_length=512)
    auth_type: str = Field("token", pattern="^(token|password)$")
    username: str = Field("", max_length=256)
    password: SecretStr | None = Field(None, max_length=1024)
    token: SecretStr | None = Field(None, max_length=8192)

    @field_validator("token")
    @classmethod
    def validate_token(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and any(ord(char) < 32 or ord(char) == 127 for char in value.get_secret_value()):
            raise ValueError("令牌不可包含控制字符")
        return value

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        return validate_optional_url(value, "OpenList 地址")


class FilterConfig(BaseModel):
    allowed_extensions: list[str] = Field(
        default_factory=lambda: [".mp4", ".mkv", ".avi", ".ts", ".wmv"], min_length=1, max_length=100
    )
    min_file_size_mb: int = Field(100, ge=0, le=102400)
    blacklist_patterns: list[str] = Field(default_factory=list, max_length=100)
    code_patterns: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("allowed_extensions")
    @classmethod
    def normalize_extensions(cls, values: list[str]) -> list[str]:
        normalized = [
            value.strip().lower() if value.strip().startswith(".") else f".{value.strip().lower()}" for value in values
        ]
        if any(
            not value[1:] or len(value) > 16 or not value[1:].replace("-", "").replace("_", "").isalnum()
            for value in normalized
        ):
            raise ValueError("扩展名格式无效")
        return list(dict.fromkeys(normalized))

    @field_validator("blacklist_patterns")
    @classmethod
    def validate_blacklist_patterns(cls, values: list[str]) -> list[str]:
        normalized = []
        for value in values:
            if len(value) > 256:
                raise ValueError("黑名单正则过长")
            try:
                re.compile(value)
            except re.error as exc:
                raise ValueError("黑名单正则格式无效") from exc
            normalized.append(value)
        return normalized

    @field_validator("code_patterns")
    @classmethod
    def validate_code_patterns(cls, values: list[str]) -> list[str]:
        normalized = []
        for value in values:
            if len(value) > 256:
                raise ValueError("番号正则过长")
            try:
                re.compile(value)
            except re.error as exc:
                raise ValueError("番号正则格式无效") from exc
            normalized.append(value)
        return normalized


class BtParserConfig(BaseModel):
    service_url: str = Field("", max_length=512)
    token: SecretStr | None = Field(None, max_length=8192)
    timeout_seconds: int = Field(45, ge=1, le=300)

    @field_validator("service_url")
    @classmethod
    def validate_service_url(cls, value: str) -> str:
        return validate_optional_url(value, "BT 解析服务地址")

    _token = field_validator("token")(OpenListConfig.validate_token.__func__)


class ProbePath(BaseModel):
    storage_mount: str = Field(min_length=1, max_length=255)
    folder: str = Field("/", min_length=1, max_length=1024)

    _paths = field_validator("storage_mount", "folder")(normalize_path)


class ProbeGroup(BaseModel):
    group_name: str = Field(min_length=1, max_length=100)
    paths: list[ProbePath] = Field(min_length=1, max_length=100)


class ConfigPatch(BaseModel):
    openlist: OpenListConfig | None = None
    filter: FilterConfig | None = None
    bt_parser: BtParserConfig | None = None
    probe_paths: list[ProbeGroup] | None = Field(None, max_length=100)


class ConnectionTestRequest(OpenListConfig):
    pass
