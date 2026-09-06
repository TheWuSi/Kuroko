from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.orm import Session

from app.models.storage import StorageGroup, StorageSpaceOverride
from app.services.config_service import get_config
from app.services.openlist_client import OpenListClient, OpenListError


def get_client(db: Session) -> OpenListClient:
    return OpenListClient(get_config(db, masked=False)["openlist"])


def storage_info(db: Session) -> list[dict[str, Any]]:
    client = get_client(db)
    remote = client.get_storage_info()
    overrides = {row.storage_mount: row for row in db.query(StorageSpaceOverride).all()}
    result = []
    for index, item in enumerate(remote, start=1):
        mount = str(item.get("mount_path") or item.get("mount") or item.get("path") or "/")
        override = overrides.get(mount)
        total = override.total_space_bytes if override else item.get("total_space") if item.get("total_space") is not None else item.get("total")
        used = item.get("used_space") if item.get("used_space") is not None else item.get("used")
        if override and used is None:
            # 部分驱动不返回 used/free，手动配额模式下通过挂载根目录递归估算已用空间。
            try:
                used = _used_bytes(client, mount)
            except OpenListError:
                used = None
        remote_free = item.get("free_space") if item.get("free_space") is not None else item.get("free")
        free = (total - used) if total is not None and used is not None else remote_free
        result.append({"id": index, "mount_path": mount, "driver": item.get("driver", "unknown"), "status": item.get("status", "active"), "total_space": total, "used_space": used, "free_space": free, "space_source": "manual" if override else "openlist"})
    return result


def _used_bytes(client: OpenListClient, root: str) -> int:
    """递归统计单个挂载点文件大小，仅用于没有原生容量信息的覆盖模式。"""
    pending = [root]
    visited: set[str] = set()
    total = 0
    while pending:
        current = str(PurePosixPath(pending.pop()))
        if current in visited:
            continue
        visited.add(current)
        for entry in client.list_files(current):
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or entry.get("path") or "")
            is_dir = bool(entry.get("is_dir") or entry.get("isDir") or entry.get("directory") or str(entry.get("type", "")).lower() in {"dir", "directory", "folder"})
            if is_dir:
                pending.append(name if name.startswith("/") else str(PurePosixPath(current) / name))
            else:
                try:
                    total += max(0, int(entry.get("size") or entry.get("length") or 0))
                except (TypeError, ValueError):
                    continue
    return total


def choose_target(db: Session, group: StorageGroup, required_size: int) -> tuple[str, int]:
    infos = {item["mount_path"]: item for item in storage_info(db)}
    candidates = []
    for path in group.paths:
        info = infos.get(path.storage_mount)
        free = info.get("free_space") if info else None
        if free is not None and free >= required_size:
            candidates.append((free - required_size, free, path))
    if not candidates:
        raise ValueError("目标存储空间不足")
    _, free, selected = sorted(candidates, key=lambda item: (item[0], item[2].storage_mount, item[2].folder_path))[0]
    return f"{selected.storage_mount}{selected.folder_path}".replace("//", "/"), free
