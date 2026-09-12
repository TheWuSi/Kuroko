"""存储容量、挂载路径匹配与下载目录选择。"""

import time
from contextlib import nullcontext
from typing import Any

from sqlalchemy.orm import Session

from app.models.storage import StorageGroup, StorageSpaceOverride
from app.services.config_service import get_config
from app.services.openlist_client import OpenListClient, OpenListError, nonnegative_int
from app.utils.paths import child_path, is_within, join_path, normalize_path


def get_client(db: Session) -> OpenListClient:
    return OpenListClient(get_config(db, masked=False)["openlist"])


def resolve_storage_path(path: str, storages: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    path = normalize_path(path)
    matches = [item for item in storages if is_within(path, item["mount_path"])]
    if not matches:
        raise ValueError("指定目录不属于任何 OpenList 挂载")
    storage = max(matches, key=lambda item: len(item["mount_path"]))
    folder = "/" + path[len(storage["mount_path"].rstrip("/")):].lstrip("/")
    return storage, folder


def storage_info(
    db: Session, *, client: OpenListClient | None = None, remote: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    with get_client(db) if client is None else nullcontext(client) as active_client:
        if remote is None:
            remote = active_client.get_storage_info()
        overrides = {row.storage_mount: row for row in db.query(StorageSpaceOverride).all()}
        result = []
        for item in remote:
            mount = item["mount_path"]
            override = overrides.get(mount)
            details = item.get("mount_details")
            details = details if isinstance(details, dict) else {}
            total = nonnegative_int(details.get("total_space"))
            used = nonnegative_int(details.get("used_space"))
            free = nonnegative_int(details.get("free_space"))
            if used is None and total is not None and free is not None and free <= total:
                used = total - free
            if override:
                total = override.total_space_bytes
                if used is None and item["status"] == "work":
                    nested_mount = any(other["mount_path"] != mount and is_within(other["mount_path"], mount) for other in remote)
                    if not nested_mount:
                        try:
                            used = _used_bytes(active_client, mount)
                        except (OpenListError, ValueError):
                            used = None
                # 手动总配额缺少完整已用容量时，不冒用驱动旧 free 值或部分统计结果。
                free = max(0, total - used) if used is not None else None
            elif total is not None and used is not None:
                free = max(0, total - used)
            result.append({
                "id": item["id"], "mount_path": mount, "driver": item["driver"], "status": item["status"],
                "total_space": total, "used_space": used, "free_space": free,
                "space_source": "manual" if override else "openlist",
            })
        return result


def _used_bytes(client: OpenListClient, root: str) -> int:
    """完整统计当前挂载的文件；超过预算时返回未知，避免把部分扫描当作全部用量。"""
    root = normalize_path(root)
    pending = [root]
    visited: set[str] = set()
    total = count = 0
    deadline = time.monotonic() + 30
    while pending:
        if time.monotonic() > deadline or len(visited) >= 1000 or count > 100000:
            raise OpenListError("容量统计超出预算，请使用提供原生容量的存储")
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        for entry in client.list_files(current):
            path = child_path(current, entry["name"])
            if not is_within(path, root):
                raise OpenListError("容量统计路径越界")
            count += 1
            if entry["is_dir"]:
                pending.append(path)
            else:
                total += entry["size"]
    return total


def choose_target(
    db: Session, group: StorageGroup, required_size: int, *,
    infos: list[dict[str, Any]] | None = None, reserved: dict[str, int] | None = None,
) -> tuple[str, int]:
    if required_size <= 0:
        raise ValueError("无法确定完整下载大小，请指定下载目录或重新解析后再自动调度")
    infos = storage_info(db) if infos is None else infos
    reserved = reserved or {}
    candidates = []
    for path in group.paths:
        target = join_path(path.storage_mount, path.folder_path)
        try:
            info, _ = resolve_storage_path(target, infos)
        except ValueError:
            continue
        if info.get("status", "work") != "work":
            continue
        free = info.get("free_space")
        if free is not None:
            free = max(0, free - reserved.get(info["mount_path"], 0))
            if free >= required_size:
                candidates.append((free, target))
    if not candidates:
        raise ValueError("分组内没有容量已知、状态正常且空间足够的存储")
    free, target = min(candidates)
    return target, free
