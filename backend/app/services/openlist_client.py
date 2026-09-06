"""OpenList HTTP 适配层。"""

from typing import Any

import httpx


class OpenListError(RuntimeError):
    pass


class OpenListClient:
    def __init__(self, config: dict[str, Any]):
        self.base_url = config.get("base_url", "").rstrip("/")
        self.auth_type = config.get("auth_type", "token")
        self.username = config.get("username", "")
        self.password = config.get("password", "")
        self.token = config.get("token", "")

    def _headers(self) -> dict[str, str]:
        if not self.token:
            return {}
        token = self.token if self.token.lower().startswith("bearer ") else f"Bearer {self.token}"
        return {"Authorization": token}

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        if not self.base_url:
            raise OpenListError("未配置 OpenList 地址")
        try:
            response = httpx.request(method, f"{self.base_url}{path}", headers=self._headers(), timeout=20, **kwargs)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OpenListError(f"OpenList 请求失败: {type(exc).__name__}") from exc
        if isinstance(data, dict) and data.get("code") not in (None, 200, 0):
            raise OpenListError(f"OpenList 返回业务错误: {str(data.get('message') or data.get('msg') or 'unknown')[:200]}")
        return data.get("data", data) if isinstance(data, dict) else data

    def login(self) -> str:
        data = self._request("POST", "/api/auth/login", json={"username": self.username, "password": self.password})
        token = data.get("token") or data.get("access_token") if isinstance(data, dict) else None
        if not token:
            raise OpenListError("OpenList 登录未返回 Token")
        self.token = token
        return token

    def test_connection(self) -> dict[str, Any]:
        data = self._request("GET", "/api/me")
        return {"connected": True, "version": data.get("version") if isinstance(data, dict) else None, "latency_ms": None}

    def list_files(self, path: str) -> list[dict[str, Any]]:
        data = self._request("POST", "/api/fs/list", json={"path": path, "page": 1, "per_page": 1000, "password": "", "refresh": False})
        return data.get("content", data.get("files", [])) if isinstance(data, dict) else []

    def get_storage_info(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/admin/storage/list")
        return data.get("content", data.get("storages", [])) if isinstance(data, dict) else []

    def add_offline_download(self, magnet: str, save_path: str) -> str:
        data = self._request("POST", "/api/fs/add_offline_download", json={"urls": [magnet], "path": save_path, "tool": "pikpak", "delete_policy": "always"})
        task_id = data.get("task_id") or data.get("id") if isinstance(data, dict) else None
        if not task_id:
            raise OpenListError("OpenList 未返回离线任务 ID")
        return str(task_id)

    def get_offline_tasks(self, task_ids: list[str] | None = None) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/admin/task/list")
        tasks = data.get("content", data.get("tasks", data.get("items", []))) if isinstance(data, dict) else []
        if task_ids:
            return [task for task in tasks if str(task.get("id") or task.get("task_id")) in task_ids]
        return tasks

    def cancel_task(self, task_id: str) -> None:
        self._request("POST", "/api/admin/task/delete", json={"tid": task_id})
