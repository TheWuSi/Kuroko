"""magnet-metadata-api 的协议适配、健康检查和可区分原因的降级。"""

import random
import threading
import time
from typing import Any

import httpx
from pydantic import BaseModel, Field, StrictInt, ValidationError, field_validator

from app.schemas.config import validate_optional_url
from app.utils.magnet_parser import clean_magnet, magnet_display_name, magnet_info_hash

MAX_BYTES = 2**63 - 1
# 元数据服务整体并发上限：解析线程数乘以每批并发不得超过该值，避免同时打开的 DHT 检索拖垮服务。
MAX_PARSE_CONCURRENCY = 32
MAX_RETRY_ATTEMPTS = 5
RETRY_BASE_DELAY = 2.0
RETRY_MAX_DELAY = 30.0
# 元数据服务自身过载或网络抖动占主导；连接被拒、DNS 失败与 4xx 立刻回落，不占用并发名额重试。
RETRYABLE_REASONS = {"bt_metadata_timeout", "bt_metadata_overloaded", "bt_metadata_connection_error"}

_parse_slots = threading.BoundedSemaphore(MAX_PARSE_CONCURRENCY)


def parse_slot() -> threading.BoundedSemaphore:
    return _parse_slots


def _relative_path(value: str) -> str:
    if (
        not value
        or len(value) > 4096
        or value.startswith("/")
        or "\\" in value
        or any(part in {"", ".", ".."} for part in value.split("/"))
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise ValueError("无效的种子相对路径")
    return value


class MetadataFile(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    size: StrictInt = Field(ge=0, le=MAX_BYTES)
    offset: StrictInt = Field(0, ge=0, le=MAX_BYTES)

    _path = field_validator("path")(_relative_path)


class MetadataPayload(BaseModel):
    info_hash: str = Field(pattern=r"^[0-9a-fA-F]{40}$")
    name: str = Field(min_length=1, max_length=1024)
    size: StrictInt = Field(ge=0, le=MAX_BYTES)
    files: list[MetadataFile] = Field(default_factory=list, max_length=100000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if "/" in value:
            raise ValueError("种子名称不可包含目录分隔符")
        return _relative_path(value)


class MagnetMetadataError(RuntimeError):
    def __init__(self, message: str, *, reason: str = "bt_metadata_unavailable", retry_after: float | None = None):
        super().__init__(message)
        self.reason = reason
        self.retry_after = retry_after


class MetadataQueueFull(RuntimeError):
    """本地解析并发已满；调用方应让出条目，由后续轮次重新领取。"""


def backoff_delay(attempt: int, retry_after: float | None = None, *, jitter: bool = True) -> float:
    """指数退避；上游给出 Retry-After 时优先服从，并加入抖动避免整批同步重试。"""
    if retry_after is not None:
        return retry_after
    delay = min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * 2 ** max(0, attempt - 1))
    return delay * (0.5 + random.random() * 0.5) if jitter else delay


def wait_retry(delay: float, stop_event: threading.Event | None = None) -> None:
    """可被停止信号打断的等待，保证停止解析或退出进程时不阻塞后台线程。"""
    if stop_event is not None:
        stop_event.wait(delay)
    else:
        time.sleep(delay)


class MagnetMetadataApiClient:
    def __init__(
        self,
        service_url: str,
        token: str = "",
        timeout: float = 45.0,
        *,
        transport: httpx.BaseTransport | None = None,
    ):
        self.service_url = validate_optional_url(service_url, "BT 解析服务地址")
        self.token = token or ""
        self.timeout = max(1.0, min(float(timeout), 300.0))
        if any(ord(char) < 32 or ord(char) == 127 for char in self.token):
            raise MagnetMetadataError("解析服务令牌包含无效字符")
        self.http = httpx.Client(
            timeout=httpx.Timeout(self.timeout, connect=min(10, self.timeout)), transport=transport
        )

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self) -> None:
        self.http.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        if not self.service_url:
            raise MagnetMetadataError("未配置 magnet-metadata-api 地址")
        headers = {}
        # 上游没有内建鉴权；仅为部署在 Bearer 认证代理后的实例保留可选令牌。
        if self.token:
            headers["Authorization"] = (
                self.token if self.token.lower().startswith("bearer ") else f"Bearer {self.token}"
            )
        try:
            response = self.http.request(method, f"{self.service_url}{path}", headers=headers, **kwargs)
        except httpx.TimeoutException as exc:
            raise MagnetMetadataError("磁力元数据服务请求超时", reason="bt_metadata_timeout") from exc
        except httpx.TransportError as exc:
            raise MagnetMetadataError("磁力元数据服务连接失败", reason="bt_metadata_connection_error") from exc
        except httpx.HTTPError as exc:
            raise MagnetMetadataError("磁力元数据服务连接失败") from exc
        if response.status_code in {408, 504}:
            raise MagnetMetadataError("磁力元数据服务解析超时", reason="bt_metadata_timeout")
        if response.status_code == 503:
            raise MagnetMetadataError(
                "磁力元数据服务过载或未就绪", reason="bt_metadata_overloaded", retry_after=self._retry_after(response)
            )
        if response.status_code == 429:
            raise MagnetMetadataError(
                "磁力元数据服务限流", reason="bt_metadata_overloaded", retry_after=self._retry_after(response)
            )
        if response.status_code == 400:
            raise MagnetMetadataError("磁力元数据服务拒绝了该磁力链接", reason="bt_metadata_invalid_request")
        if not 200 <= response.status_code < 300:
            raise MagnetMetadataError(f"磁力元数据服务请求失败（HTTP {response.status_code}）")
        try:
            return response.json()
        except ValueError as exc:
            raise MagnetMetadataError("磁力元数据服务未返回有效 JSON", reason="bt_metadata_invalid_response") from exc

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        try:
            value = float(response.headers.get("Retry-After", "").strip())
        except ValueError:
            return None
        return value if 0 <= value <= 300 else None

    def fetch_metadata(self, magnet_uri: str) -> dict[str, Any]:
        magnet_uri = clean_magnet(magnet_uri)
        payload = self._request("POST", "/api/v1/metadata", json={"magnet_uri": magnet_uri})
        try:
            metadata = MetadataPayload.model_validate(payload)
            if metadata.info_hash.lower() != magnet_info_hash(magnet_uri):
                raise ValueError("响应 Hash 不匹配")
            files = metadata.files
            # 单文件种子的 Go info.Files 为空，实际文件由 name 和 size 表达。
            if not files:
                files = [MetadataFile(path=metadata.name, size=metadata.size)]
            if sum(file.size for file in files) != metadata.size or len({file.path for file in files}) != len(files):
                raise ValueError("文件清单与总大小不一致")
            if any(file.offset + file.size > metadata.size for file in files):
                raise ValueError("文件偏移超出种子范围")
        except (ValidationError, ValueError) as exc:
            raise MagnetMetadataError("磁力元数据服务返回格式无效", reason="bt_metadata_invalid_response") from exc
        return {
            "info_hash": metadata.info_hash.lower(),
            "name": metadata.name,
            "size": metadata.size,
            "files": [{"name": file.path, **file.model_dump()} for file in files],
            "metadata_fallback": False,
        }

    def parse(self, magnet_uri: str) -> dict[str, Any]:
        return self.fetch_metadata(magnet_uri)

    def parse_with_retry(
        self,
        magnet_uri: str,
        *,
        attempts: int = MAX_RETRY_ATTEMPTS,
        stop_event: threading.Event | None = None,
        slot: threading.BoundedSemaphore | None = None,
    ) -> dict[str, Any]:
        """在本地并发名额内重试可恢复的上游故障；网络等待期间不占用解析名额以外的资源。"""
        slot = slot if slot is not None else _parse_slots
        attempts = max(1, min(attempts, MAX_RETRY_ATTEMPTS))
        for attempt in range(1, attempts + 1):
            if stop_event is not None and stop_event.is_set():
                raise MagnetMetadataError("解析已停止", reason="bt_metadata_unavailable")
            if not slot.acquire(timeout=1):
                raise MetadataQueueFull("本地解析队列已满")
            try:
                return self.fetch_metadata(magnet_uri)
            except MagnetMetadataError as exc:
                if exc.reason not in RETRYABLE_REASONS or attempt >= attempts:
                    raise
                delay = backoff_delay(attempt, exc.retry_after)
            finally:
                slot.release()
            wait_retry(delay, stop_event)
        raise MagnetMetadataError("磁力元数据服务不可用", reason="bt_metadata_unavailable")

    def parse_with_fallback(
        self,
        magnet_uri: str,
        *,
        attempts: int = 1,
        stop_event: threading.Event | None = None,
        slot: threading.BoundedSemaphore | None = None,
    ) -> dict[str, Any]:
        magnet_uri = clean_magnet(magnet_uri)
        try:
            return self.parse_with_retry(magnet_uri, attempts=attempts, stop_event=stop_event, slot=slot)
        except (MagnetMetadataError, MetadataQueueFull) as exc:
            reason = exc.reason if isinstance(exc, MagnetMetadataError) else "bt_metadata_unavailable"
            return {
                "info_hash": magnet_info_hash(magnet_uri),
                "name": magnet_display_name(magnet_uri),
                "size": 0,
                "files": [],
                "metadata_fallback": True,
                "fallback": True,
                "fallback_reason": reason,
            }

    def test_connection(self) -> dict[str, Any]:
        started = time.perf_counter()
        payload = self._request("GET", "/api/v1/health", timeout=min(self.timeout, 10))
        if not isinstance(payload, dict) or payload.get("status") != "ok" or not isinstance(payload.get("stats"), dict):
            raise MagnetMetadataError("magnet-metadata-api 健康检查失败", reason="bt_metadata_invalid_response")
        stats = {}
        for key in ("active_torrents", "active_locks", "dlq_entries", "active_itorrents_requests"):
            if key in payload["stats"]:
                value = payload["stats"][key]
                if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_BYTES:
                    raise MagnetMetadataError("magnet-metadata-api 健康数据无效", reason="bt_metadata_invalid_response")
                stats[key] = value
        return {
            "connected": True,
            "service_name": "magnet-metadata-api",
            "stats": stats,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }


MagnetMetadataClient = MagnetMetadataApiClient
