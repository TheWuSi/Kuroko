from typing import Any

import httpx

from app.services.openlist_client import OpenListError


class BtParserClient:
    def __init__(self, service_url: str, token: str = ""):
        self.service_url = service_url.rstrip("/")
        self.token = token

    def parse(self, magnet: str) -> dict[str, Any]:
        if not self.service_url:
            return {"name": "", "files": []}
        try:
            response = httpx.post(f"{self.service_url}/parse", json={"magnet": magnet}, headers={"Authorization": self.token} if self.token else {}, timeout=60)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OpenListError(f"BT 解析服务不可用: {type(exc).__name__}") from exc
        return data.get("data", data)
