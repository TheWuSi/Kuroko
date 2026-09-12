"""magnet-metadata-api 的 HTTP 适配器。

上游服务负责 DHT/Peer 元数据获取，本模块只处理协议、超时和结果形状，
这样磁力业务层可以在上游暂不可用时继续使用 dn 做保底识别。
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx

from app.utils.magnet_parser import magnet_display_name


class MagnetMetadataError(RuntimeError):
    """元数据服务不可用或返回了无效结果。"""


class MagnetMetadataApiClient:
    def __init__(self, service_url: str, token: str = "", timeout: float = 45.0):
        self.service_url = service_url.strip().rstrip("/")
        self.token = token or ""
        self.timeout = max(1.0, min(float(timeout), 300.0))

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = self.token if self.token.lower().startswith("bearer ") else f"Bearer {self.token}"
        return headers

    def _url(self, path: str) -> str:
        if not self.service_url:
            raise MagnetMetadataError("未配置 magnet-metadata-api 地址")
        return urljoin(f"{self.service_url}/", path.lstrip("/"))

    def fetch_metadata(self, magnet_uri: str) -> dict[str, Any]:
        """请求 DHT 元数据并归一化文件字段。

        不在这里吞掉异常，调用方可据异常原因决定是否降级；这样健康检查
        与业务解析不会把网络故障误报成空文件列表。
        """
        try:
            response = httpx.request(
                "POST",
                self._url("/api/v1/metadata"),
                headers=self._headers(),
                json={"magnet_uri": magnet_uri},
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError, MagnetMetadataError) as exc:
            if isinstance(exc, MagnetMetadataError):
                raise
            raise MagnetMetadataError("磁力元数据服务请求失败") from exc
        if not isinstance(payload, dict):
            raise MagnetMetadataError("磁力元数据服务返回格式无效")
        files = payload.get("files") or []
        if not isinstance(files, list):
            files = []
        normalized: list[dict[str, Any]] = []
        for item in files:
            if not isinstance(item, dict):
                continue
            path = item.get("path") or item.get("name")
            if not path:
                continue
            try:
                size = max(0, int(item.get("size") or item.get("length") or 0))
            except (TypeError, ValueError):
                size = 0
            normalized.append({"name": str(path), "path": str(path), "size": size, "offset": item.get("offset", 0)})
        return {
            "info_hash": str(payload.get("info_hash") or ""),
            "name": str(payload.get("name") or ""),
            "size": max(0, int(payload.get("size") or sum(item["size"] for item in normalized))),
            "files": normalized,
            "metadata_fallback": False,
        }

    # 兼容旧 BtParserClient 的调用命名，便于外部插件平滑升级。
    def parse(self, magnet_uri: str) -> dict[str, Any]:
        return self.fetch_metadata(magnet_uri)

    def parse_with_fallback(self, magnet_uri: str) -> dict[str, Any]:
        try:
            return self.fetch_metadata(magnet_uri)
        except MagnetMetadataError as exc:
            return {
                "info_hash": "",
                "name": magnet_display_name(magnet_uri),
                "size": 0,
                "files": [],
                "metadata_fallback": True,
                "fallback": True,
                "fallback_reason": "bt_metadata_timeout" if isinstance(exc.__cause__, httpx.TimeoutException) else "bt_metadata_unavailable",
            }

    def test_connection(self) -> dict[str, Any]:
        """执行轻量健康检查并返回耗时，不发送用户磁力内容。"""
        import time

        started = time.perf_counter()
        try:
            response = httpx.request("GET", self._url("/health"), headers=self._headers(), timeout=min(self.timeout, 10.0))
            response.raise_for_status()
        except (httpx.HTTPError, MagnetMetadataError) as exc:
            raise MagnetMetadataError("magnet-metadata-api 连接失败") from exc
        return {"connected": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}


# 计划文档使用的名称，保留简短别名方便导入。
MagnetMetadataClient = MagnetMetadataApiClient
