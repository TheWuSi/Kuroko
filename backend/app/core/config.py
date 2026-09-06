"""应用配置。"""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Kuroko"
    environment: str = "development"
    secret_key: SecretStr = SecretStr("change-me-in-production")
    access_token_minutes: int = 30
    refresh_token_days: int = 7
    database_url: str = "sqlite:///./data/kuroko.db"
    openlist_base_url: str = ""
    bt_parser_service_url: str = ""
    task_poll_seconds: int = 30
    cors_origins: str = "http://localhost:5173"
    static_dir: str = ""

    model_config = SettingsConfigDict(env_prefix="KUROKO_", env_file=".env", extra="ignore")

    @property
    def database_path(self) -> Path | None:
        if not self.database_url.startswith("sqlite:///"):
            return None
        return Path(self.database_url.removeprefix("sqlite:///"))

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
