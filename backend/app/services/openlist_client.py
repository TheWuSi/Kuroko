"""OpenList v4.2.6 HTTP 适配层，协议依据官方文档和对应版本源码。"""

import hashlib
import json
import re
import time
from collections.abc import Callable
from typing import Any, Literal

import httpx

from app.schemas.config import validate_optional_url
from app.services.read_cache import ReadCache
from app.utils.magnet_parser import clean_magnet
from app.utils.paths import child_path, normalize_path

TaskKind = Literal["offline_download", "offline_download_transfer"]
MAX_BYTES = 2**63 - 1


class OpenListError(RuntimeError):
    def __init__(self, message: str, *, code: int | None = None, outcome_unknown: bool = False):
        super().__init__(message)
        self.code = code
        self.outcome_unknown = outcome_unknown


def nonnegative_int(value: Any) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_BYTES:
        return value
    return None


class OpenListClient:
    PAGE_SIZE = 100
    MAX_PAGES = 1000

    def __init__(
        self,
        config: dict[str, Any],
        *,
        transport: httpx.BaseTransport | None = None,
        cache: ReadCache | None = None,
    ):
        self.cache = cache
        # 凭据变化即切换命名空间，缓存键和诊断输出都不暴露凭据本身。
        self.cache_scope = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
        self.base_url = validate_optional_url(config.get("base_url", ""), "OpenList 地址")
        self.auth_type = config.get("auth_type", "token")
        self.username = config.get("username") or ""
        self.password = config.get("password") or ""
        # 兼容旧配置中粘贴的 Bearer 前缀；发给 OpenList 的始终是原始令牌。
        self.token = re.sub(r"^Bearer\s+", "", config.get("token") or "", flags=re.IGNORECASE).strip()
        if self.auth_type == "password":
            self.token = ""
        if any(ord(char) < 32 or ord(char) == 127 for char in self.token):
            raise OpenListError("OpenList 令牌包含无效字符")
        self.http = httpx.Client(timeout=httpx.Timeout(20, connect=10), transport=transport)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self) -> None:
        self.http.close()

    def cached(self, key: tuple, load, *, ttl: float = 15, refresh: bool = False):
        if self.cache is None:
            return load()
        return self.cache.get((self.cache_scope, *key), load, ttl=ttl, refresh=refresh)

    def _request(self, method: str, path: str, *, auth: bool = True, retry_auth: bool = True, **kwargs: Any) -> Any:
        if not self.base_url:
            raise OpenListError("未配置 OpenList 地址")
        if auth and not self.token:
            if self.auth_type == "password":
                self.login()
            else:
                raise OpenListError("未配置 OpenList 令牌", code=401)
        submitting = path == "/api/fs/add_offline_download"
        try:
            response = self.http.request(
                method,
                f"{self.base_url}{path}",
                headers={"Authorization": self.token} if auth else {},
                **kwargs,
            )
        except httpx.HTTPError as exc:
            message = "OpenList 请求超时" if isinstance(exc, httpx.TimeoutException) else "OpenList 连接失败"
            if submitting:
                message = "OpenList 提交结果未确认，请先在 OpenList 检查任务，避免重复提交"
            raise OpenListError(message, outcome_unknown=submitting) from exc
        try:
            payload = response.json()
        except ValueError:
            payload = None
        code = payload.get("code") if isinstance(payload, dict) else None
        # OpenList 的业务错误通常仍使用 HTTP 200，必须检查响应体中的 code。
        if response.status_code == 401 or code == 401:
            if auth and self.auth_type == "password" and retry_auth:
                self.token = ""
                self.login(refresh=True)
                return self._request(method, path, auth=auth, retry_auth=False, **kwargs)
            raise OpenListError("OpenList 鉴权失败，请检查账号或令牌", code=401)
        if not 200 <= response.status_code < 300:
            if submitting and (response.status_code >= 500 or response.status_code == 408):
                raise OpenListError(
                    "OpenList 提交结果未确认，请先在 OpenList 检查任务，避免重复提交",
                    code=response.status_code,
                    outcome_unknown=True,
                )
            raise OpenListError(f"OpenList 请求失败（HTTP {response.status_code}）", code=response.status_code)
        if not isinstance(payload, dict) or not isinstance(code, int) or isinstance(code, bool):
            raise OpenListError("OpenList 返回格式无效", outcome_unknown=submitting)
        if code != 200:
            messages = {403: "OpenList 权限不足", 404: "OpenList 资源不存在"}
            raise OpenListError(messages.get(code, f"OpenList 拒绝请求（业务状态 {code}）"), code=code)
        return payload.get("data")

    def login(self, *, refresh: bool = False) -> str:
        self.token = self.cached(("login",), self._login, ttl=600, refresh=refresh)
        return self.token

    def _login(self) -> str:
        if not self.username or not self.password:
            raise OpenListError("请配置 OpenList 用户名和密码", code=401)
        data = self._request(
            "POST",
            "/api/auth/login",
            auth=False,
            json={"username": self.username, "password": self.password},
        )
        token = data.get("token") if isinstance(data, dict) else None
        if not isinstance(token, str) or not token or len(token) > 8192 or any(char.isspace() for char in token):
            raise OpenListError("OpenList 登录未返回有效令牌")
        self.token = token
        return token

    def test_connection(self) -> dict[str, Any]:
        started = time.perf_counter()
        user = self._request("GET", "/api/me")
        if not isinstance(user, dict) or user.get("role") != 2:
            raise OpenListError("Kuroko 存储管理需要 OpenList 管理员账号或管理员令牌", code=403)
        version = None
        try:
            settings = self._request("GET", "/api/public/settings", auth=False)
            if isinstance(settings, dict) and isinstance(settings.get("version"), str):
                version = settings["version"][:100]
        except OpenListError:
            # 版本信息只用于展示，不影响已确认成功的身份验证。
            pass
        return {"connected": True, "version": version, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}

    def _pages(
        self,
        method: str,
        endpoint: str,
        body: dict[str, Any] | None = None,
        *,
        deadline: float | None = None,
        before_page: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        seen: set[str | int] = set()
        expected_total = None
        for page in range(1, self.MAX_PAGES + 1):
            if before_page is not None:
                before_page()
            pagination = {"page": page, "per_page": self.PAGE_SIZE}
            kwargs = {"json": {**body, **pagination}} if body is not None else {"params": pagination}
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OpenListError("OpenList 列表读取超出统计时间预算")
                kwargs["timeout"] = min(20, remaining)
            data = self._request(method, endpoint, **kwargs)
            if deadline is not None and time.monotonic() > deadline:
                raise OpenListError("OpenList 列表读取超出统计时间预算")
            if not isinstance(data, dict) or nonnegative_int(data.get("total")) is None:
                raise OpenListError("OpenList 分页响应格式无效")
            if expected_total is not None and data["total"] != expected_total:
                raise OpenListError("OpenList 分页期间列表发生变化，请刷新后重试")
            expected_total = data["total"]
            content = data.get("content")
            if content is None and data["total"] == 0:
                content = []
            if not isinstance(content, list) or len(content) > self.PAGE_SIZE:
                raise OpenListError("OpenList 分页内容格式无效")
            for item in content:
                if not isinstance(item, dict):
                    raise OpenListError("OpenList 分页内容格式无效")
                key = item.get("name") if body is not None else item.get("id")
                if not isinstance(key, (str, int)) or isinstance(key, bool) or key in seen:
                    raise OpenListError("OpenList 分页返回了无效或重复记录，请刷新后重试")
                seen.add(key)
                items.append(item)
            if len(items) > expected_total:
                raise OpenListError("OpenList 分页数量与总数不一致")
            if len(items) == expected_total:
                return items
            if not content:
                raise OpenListError("OpenList 分页结果不完整")
        raise OpenListError("OpenList 列表超过单次读取上限")

    def list_files(
        self,
        path: str,
        *,
        deadline: float | None = None,
        refresh: bool = False,
        before_page: Callable[[], None] | None = None,
    ) -> list[dict[str, Any]]:
        path = normalize_path(path)
        if before_page is not None:
            # 长扫描有自己的取消检查，不能与普通目录浏览共享正在执行的请求。
            return self._list_files(path, deadline=deadline, refresh=refresh, before_page=before_page)
        return self.cached(
            ("directory", path),
            lambda: self._list_files(path, deadline=deadline, refresh=refresh),
            refresh=refresh,
        )

    def _list_files(
        self, path: str, *, deadline: float | None, refresh: bool, before_page: Callable[[], None] | None = None
    ) -> list[dict[str, Any]]:
        path = normalize_path(path)
        entries = self._pages(
            "POST",
            "/api/fs/list",
            {"path": path, "password": "", "refresh": refresh},
            deadline=deadline,
            before_page=before_page,
        )
        for entry in entries:
            try:
                child_path(path, entry.get("name"))
            except ValueError as exc:
                raise OpenListError("OpenList 返回了无效的文件路径") from exc
            if not isinstance(entry.get("is_dir"), bool) or nonnegative_int(entry.get("size")) is None:
                raise OpenListError("OpenList 返回了无效的文件属性")
        return [{key: item[key] for key in ("name", "size", "is_dir")} for item in entries]

    def get_file(self, path: str, *, timeout: float | None = None, refresh: bool = False) -> dict[str, Any]:
        path = normalize_path(path)
        return self.cached(("file", path), lambda: self._get_file(path, timeout=timeout), refresh=refresh)

    def _get_file(self, path: str, *, timeout: float | None = None) -> dict[str, Any]:
        options = {"timeout": timeout} if timeout is not None else {}
        data = self._request("POST", "/api/fs/get", json={"path": normalize_path(path), "password": ""}, **options)
        if not isinstance(data, dict) or not isinstance(data.get("is_dir"), bool):
            raise OpenListError("OpenList 文件信息格式无效")
        return {key: data.get(key) for key in ("name", "size", "is_dir", "mount_details")}

    def get_storage_info(self, *, refresh: bool = False) -> list[dict[str, Any]]:
        return self.cached(("storages",), self._get_storage_info, ttl=30, refresh=refresh)

    def _get_storage_info(self) -> list[dict[str, Any]]:
        entries = self._pages("GET", "/api/admin/storage/list")
        result = []
        for entry in entries:
            if not nonnegative_int(entry.get("id")):
                raise OpenListError("OpenList 存储 ID 无效")
            try:
                mount = normalize_path(entry.get("mount_path"))
            except ValueError as exc:
                raise OpenListError("OpenList 挂载路径无效") from exc
            # addition 含刷新令牌等凭据，只提取诊断容量开关所需的布尔值，绝不向外透传。
            addition = entry.get("addition")
            if isinstance(addition, str) and len(addition) <= 1024 * 1024:
                try:
                    addition = json.loads(addition)
                except ValueError:
                    addition = None
            usage_disabled = isinstance(addition, dict) and addition.get("disable_disk_usage") is True
            result.append(
                {
                    "id": entry["id"],
                    "mount_path": mount,
                    "driver": entry.get("driver") if isinstance(entry.get("driver"), str) else "unknown",
                    "status": "disabled"
                    if entry.get("disabled")
                    else "work"
                    if entry.get("status") == "work"
                    else "error",
                    "mount_details": entry.get("mount_details"),
                    "disk_usage_disabled": usage_disabled,
                }
            )
        return result

    def get_offline_tools(self, path: str) -> list[str]:
        path = normalize_path(path)
        return self.cached(("tools", path), lambda: self._get_offline_tools(path), ttl=30)

    def _get_offline_tools(self, path: str) -> list[str]:
        data = self._request(
            "GET",
            "/api/public/offline_download_tools",
            auth=False,
            params={"path": normalize_path(path)},
        )
        if data is None:
            return []
        if not isinstance(data, list) or any(not isinstance(item, str) for item in data):
            raise OpenListError("OpenList 离线工具响应格式无效")
        return data

    def add_offline_download(self, magnet: str, save_path: str) -> str:
        data = self._request(
            "POST",
            "/api/fs/add_offline_download",
            json={
                "urls": [clean_magnet(magnet)],
                "path": normalize_path(save_path),
                "tool": "PikPak",
                "delete_policy": "delete_always",
            },
        )
        tasks = data.get("tasks") if isinstance(data, dict) else None
        if not isinstance(tasks, list) or len(tasks) != 1 or not isinstance(tasks[0], dict):
            raise OpenListError("OpenList 未返回离线任务，请检查上游任务后再操作", outcome_unknown=True)
        task_id = tasks[0].get("id")
        if not isinstance(task_id, str) or not task_id or len(task_id) > 255:
            raise OpenListError("OpenList 未返回有效任务 ID", outcome_unknown=True)
        return task_id

    @staticmethod
    def _task_path(kind: TaskKind, action: str) -> str:
        if kind not in {"offline_download", "offline_download_transfer"}:
            raise ValueError("不支持的 OpenList 任务类型")
        return f"/api/task/{kind}/{action}"

    def _safe_task(self, item: Any) -> dict[str, Any]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not 1 <= len(item["id"]) <= 255:
            raise OpenListError("OpenList 任务响应格式无效")
        result = {
            key: item.get(key)
            for key in (
                "id",
                "name",
                "state",
                "status",
                "progress",
                "total_bytes",
                "error",
                "start_time",
                "end_time",
            )
        }
        for key in ("name", "status", "error"):
            value = result[key]
            if value is not None:
                if not isinstance(value, str):
                    raise OpenListError("OpenList 任务描述格式无效")
                for secret in (self.password, self.token):
                    if secret:
                        value = value.replace(secret, "[已隐藏]")
                result[key] = re.sub(r"https?://\S+", "[上游地址]", value)[:2048]
        return result

    def get_offline_tasks(
        self, task_ids: list[str] | None = None, *, kind: TaskKind = "offline_download"
    ) -> list[dict[str, Any]]:
        by_id = {}
        for action in ("undone", "done"):
            data = self._request("GET", self._task_path(kind, action))
            if data is None:
                data = []
            if not isinstance(data, list):
                raise OpenListError("OpenList 任务列表格式无效")
            for raw in data:
                item = self._safe_task(raw)
                if task_ids is None or item["id"] in task_ids:
                    by_id[item["id"]] = item
        return list(by_id.values())

    def get_task(self, task_id: str, *, kind: TaskKind = "offline_download") -> dict[str, Any]:
        return self._safe_task(self._request("POST", self._task_path(kind, "info"), params={"tid": task_id}))

    def cancel_task(self, task_id: str, *, kind: TaskKind = "offline_download") -> None:
        self._request("POST", self._task_path(kind, "cancel"), params={"tid": task_id})
