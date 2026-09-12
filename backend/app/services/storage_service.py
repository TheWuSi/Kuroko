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
    folder = "/" + path[len(storage["mount_path"].rstrip("/")) :].lstrip("/")
    return storage, folder


def _capacity_values(details: Any) -> tuple[int | None, int | None, int | None]:
    details = details if isinstance(details, dict) else {}
    total = nonnegative_int(details.get("total_space"))
    used = nonnegative_int(details.get("used_space"))
    free = nonnegative_int(details.get("free_space"))
    # GoogleDrive 的无限配额及未取得配额的驱动会返回 total=0，不能据此认定磁盘已满。
    if total == 0:
        total, free = None, None
        if used == 0:
            used = None
    if used is None and total is not None and free is not None and free <= total:
        used = total - free
    if total is not None and used is not None:
        free = max(0, total - used)
    elif total is not None and free is not None and free > total:
        free = None
    return total, used, free


def storage_info(
    db: Session,
    *,
    client: OpenListClient | None = None,
    remote: list[dict[str, Any]] | None = None,
    storage_id: int | None = None,
) -> list[dict[str, Any]]:
    with get_client(db) if client is None else nullcontext(client) as active_client:
        if remote is None:
            remote = active_client.get_storage_info()
        overrides = {row.storage_mount: row for row in db.query(StorageSpaceOverride).all()}
        result = []
        deadline = time.monotonic() + 30
        for item in remote:
            if storage_id is not None and item["id"] != storage_id:
                continue
            mount = item["mount_path"]
            override = overrides.get(mount)
            total, used, free = _capacity_values(item.get("mount_details"))
            space_error = None
            needs_native_usage = used is None if override else free is None
            if needs_native_usage and item["status"] == "work" and not item.get("disk_usage_disabled"):
                # 管理列表仅短暂等待各驱动，OneDrive 等较慢驱动可能未带 mount_details。
                # 单独读取挂载根目录，可复用已就绪的容量缓存，也兼容管理页隐藏容量的配置。
                try:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise OpenListError("容量查询超出时间预算")
                    root = active_client.get_file(mount, timeout=min(5, remaining))
                    root_total, root_used, root_free = _capacity_values(root.get("mount_details"))
                    if root_used is not None:
                        used = root_used
                    if root_total is not None:
                        total = root_total
                    if root_free is not None:
                        free = root_free
                except OpenListError as exc:
                    space_error = f"原生容量查询失败：{exc}"
            if override:
                total = override.total_space_bytes
                if used is None and item["status"] == "work":
                    nested_mount = any(
                        other["mount_path"] != mount and is_within(other["mount_path"], mount) for other in remote
                    )
                    if nested_mount:
                        space_error = "此挂载包含独立子挂载，无法完整统计用量；请在 OpenList 启用原生容量查询"
                    else:
                        try:
                            used = _used_bytes(active_client, mount, deadline=deadline)
                        except (OpenListError, ValueError) as exc:
                            used = None
                            space_error = f"手动配额已保存，但目录用量统计失败：{exc}"
                # 手动总配额缺少完整已用容量时，不冒用驱动旧 free 值或部分统计结果。
                free = max(0, total - used) if used is not None else None
            elif total is not None and used is not None:
                free = max(0, total - used)
            if free is None:
                if item.get("disk_usage_disabled"):
                    space_error = "OpenList 此挂载已关闭原生容量统计（disable_disk_usage）。" + (space_error or "")
                space_error = space_error or (
                    "驱动未提供有效总配额，可手动设置总容量"
                    if used is not None
                    else "未取得原生容量；请检查 OpenList 的容量显示设置、驱动授权及日志"
                )
            else:
                space_error = None
            result.append(
                {
                    "id": item["id"],
                    "mount_path": mount,
                    "driver": item["driver"],
                    "status": item["status"],
                    "total_space": total,
                    "used_space": used,
                    "free_space": free,
                    "space_source": "manual" if override else "openlist",
                    "space_error": space_error,
                }
            )
        return result


def _used_bytes(client: OpenListClient, root: str, *, deadline: float | None = None) -> int:
    """完整统计当前挂载的文件；超过预算时返回未知，避免把部分扫描当作全部用量。"""
    root = normalize_path(root)
    pending = [root]
    visited: set[str] = set()
    total = count = 0
    deadline = deadline if deadline is not None else time.monotonic() + 30
    while pending:
        if time.monotonic() > deadline or len(visited) >= 1000 or count > 100000:
            raise OpenListError("容量统计超出预算，请使用提供原生容量的存储")
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        for entry in client.list_files(current, deadline=deadline):
            if time.monotonic() > deadline or count >= 100000:
                raise OpenListError("容量统计超出预算，请使用提供原生容量的存储")
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
    db: Session,
    group: StorageGroup,
    required_size: int,
    *,
    infos: list[dict[str, Any]] | None = None,
    reserved: dict[str, int] | None = None,
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
