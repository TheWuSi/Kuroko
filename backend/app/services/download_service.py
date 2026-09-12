"""PikPak 离线提交及 OpenList 任务状态同步。"""

import math
import threading
from typing import Any

from sqlalchemy.orm import Session

from app.models.task import DownloadTask, TaskStatus
from app.services.config_service import get_config
from app.services.library_service import duplicate_decision, find_group
from app.services.magnet_metadata_client import MagnetMetadataApiClient
from app.services.magnet_service import metadata_variant
from app.services.openlist_client import OpenListError, nonnegative_int
from app.services.storage_service import choose_target, get_client, is_ignored_path, resolve_storage_path, storage_info
from app.utils.code_extractor import canonical_code
from app.utils.magnet_parser import clean_magnet, magnet_info_hash
from app.utils.paths import normalize_path

# tache v0.2.2 的真实数字状态；status 字段是描述文本，不能用它判断是否完成。
STATE_STATUS = {
    0: TaskStatus.pending.value,
    1: TaskStatus.downloading.value,
    2: TaskStatus.completed.value,
    3: TaskStatus.downloading.value,
    4: TaskStatus.cancelled.value,
    5: TaskStatus.pending.value,
    6: TaskStatus.downloading.value,
    7: TaskStatus.failed.value,
    8: TaskStatus.pending.value,
    9: TaskStatus.pending.value,
}

submit_lock = threading.Lock()


def normalize_task(remote: dict[str, Any]) -> dict[str, Any]:
    state = remote.get("state")
    if not isinstance(state, int) or isinstance(state, bool) or state not in STATE_STATUS:
        raise OpenListError("OpenList 返回了无法识别的任务状态")
    progress = remote.get("progress")
    if not isinstance(progress, (float, int)) or isinstance(progress, bool) or not math.isfinite(progress):
        raise OpenListError("OpenList 返回了无效的任务进度")
    progress = 100.0 if state == 2 else min(100.0, max(0.0, float(progress)))
    total = nonnegative_int(remote.get("total_bytes"))
    if total is None:
        raise OpenListError("OpenList 返回了无效的任务大小")
    return {
        "status": STATE_STATUS[state],
        "progress": progress,
        "total_size": total,
        "downloaded_size": int(total * progress / 100),
        "error_message": remote.get("error") or None,
        "state": state,
        "status_detail": remote.get("status") or "",
    }


def _active_reservations(db: Session, mounts: list[dict[str, Any]]) -> dict[str, int]:
    reserved: dict[str, int] = {}
    active = (
        db.query(DownloadTask)
        .filter(
            DownloadTask.status.in_([TaskStatus.pending.value, TaskStatus.downloading.value]),
        )
        .all()
    )
    # 浏览器逐条投递也必须计入此前任务。保守预留完整体积，避免上游容量尚未更新时过量分配。
    for task in active:
        try:
            storage, _ = resolve_storage_path(task.target_path, mounts)
        except ValueError:
            continue
        mount = storage["mount_path"]
        reserved[mount] = reserved.get(mount, 0) + task.total_size
    return reserved


def _same_magnet(left: str, info_hash: str) -> bool:
    try:
        return magnet_info_hash(left) == info_hash
    except ValueError:
        # 旧数据可能含未校验的 Hash，不应影响新任务提交。
        return False


def submit_batch(db: Session, tasks: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    # 单进程服务中串行完成查重与本地占位，避免两个浏览器请求同时穿过去重检查。
    with submit_lock:
        return _submit_batch(db, tasks)


def _submit_batch(db: Session, tasks: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    submitted, skipped, failed = [], [], []
    config = get_config(db, masked=False)["bt_parser"]
    mounts = infos = None
    metadata_cache: dict[str, dict[str, Any]] = {}
    checked_paths: set[str] = set()
    reserved: dict[str, int] = {}
    with (
        get_client(db) as client,
        MagnetMetadataApiClient(
            config["service_url"],
            config["token"],
            config["timeout_seconds"],
        ) as parser,
    ):
        for index, item in enumerate(tasks):
            task: DownloadTask | None = None
            try:
                magnet = clean_magnet(item["magnet"])
                code = canonical_code(item["code"])
                if mounts is None:
                    mounts = client.get_storage_info()
                    reserved = _active_reservations(db, mounts)
                if item.get("target_path") and is_ignored_path(db, item["target_path"], mounts):
                    raise ValueError("下载目标所在存储已被忽略，请先在存储页面恢复")
                info_hash = magnet_info_hash(magnet)
                if info_hash not in metadata_cache:
                    metadata_cache[info_hash] = parser.parse_with_fallback(magnet)
                metadata = metadata_cache[info_hash]
                variant = metadata_variant(metadata, code, magnet)
                if variant == "original" and item.get("variant"):
                    variant = item["variant"]
                size = metadata["size"]
                if item.get("target_path"):
                    target = normalize_path(item["target_path"])
                else:
                    if infos is None:
                        infos = storage_info(db, client=client, remote=mounts, include_ignored=True)
                    target, _ = choose_target(
                        db,
                        find_group(db, item.get("target_group")),
                        size,
                        infos=infos,
                        reserved=reserved,
                    )
                storage, _ = resolve_storage_path(target, mounts)
                if is_ignored_path(db, target, mounts):
                    raise ValueError("下载目标所在存储已被忽略")
                if storage["status"] != "work":
                    raise ValueError("目标存储当前不可用")
                active_tasks = (
                    db.query(DownloadTask)
                    .filter(
                        DownloadTask.target_path == target,
                        DownloadTask.status.in_([TaskStatus.pending.value, TaskStatus.downloading.value]),
                    )
                    .all()
                )
                active = next((task for task in active_tasks if _same_magnet(task.magnet, info_hash)), None)
                if active:
                    skipped.append(
                        {
                            "index": index,
                            "code": code,
                            "magnet": magnet,
                            "reason": "already_submitted",
                            "existing_location": target,
                            "task_id": active.task_id,
                        }
                    )
                    continue
                decision = duplicate_decision(
                    db,
                    code,
                    variant,
                    target_group=item.get("target_group"),
                    target_path=target,
                )
                if decision["duplicate_blocked"] and not item.get("force", False):
                    skipped.append(
                        {
                            "index": index,
                            "code": code,
                            "magnet": magnet,
                            "reason": "already_exists",
                            "existing_location": decision["existing_location"],
                        }
                    )
                    continue
                if target not in checked_paths:
                    try:
                        destination = client.get_file(target)
                        if not destination["is_dir"]:
                            raise ValueError("下载目标必须是目录")
                    except OpenListError as exc:
                        # 新目录由 OpenList 创建，Kuroko 不额外添加任何目录层级。
                        if exc.code != 404:
                            raise
                    if "PikPak" not in client.get_offline_tools(target):
                        raise ValueError("OpenList 未启用 PikPak 离线工具，请检查 PikPak 挂载和离线临时目录")
                    checked_paths.add(target)
                task = DownloadTask(code=code, variant=variant, magnet=magnet, target_path=target, total_size=size)
                db.add(task)
                # 先确认本地能够保存任务，再执行不可回滚的上游提交；各条任务单独提交事务。
                db.commit()
                task.openlist_task_id = client.add_offline_download(magnet, target)
                db.commit()
                reserved[storage["mount_path"]] = reserved.get(storage["mount_path"], 0) + size
                submitted.append(
                    {
                        "index": index,
                        "code": code,
                        "magnet": magnet,
                        "task_id": task.task_id,
                        "target_path": target,
                        "openlist_task_id": task.openlist_task_id,
                        "total_size": size,
                        "metadata_fallback": metadata["metadata_fallback"],
                    }
                )
            except (OpenListError, ValueError) as exc:
                unknown = isinstance(exc, OpenListError) and exc.outcome_unknown
                if task is not None:
                    # 无法确认的请求继续占位，避免再次点击或另一个请求重复创建上游任务。
                    task.status = TaskStatus.pending.value if unknown else TaskStatus.failed.value
                    task.error_message = str(exc)
                    db.commit()
                    if unknown:
                        reserved[storage["mount_path"]] = reserved.get(storage["mount_path"], 0) + size
                failed.append(
                    {
                        "index": index,
                        "code": item["code"],
                        "magnet": item["magnet"],
                        "task_id": task.task_id if task else None,
                        "message": str(exc),
                        "reason": "submission_unknown"
                        if unknown
                        else "upstream_error"
                        if isinstance(exc, OpenListError)
                        else "invalid_target",
                    }
                )
    return {"submitted": submitted, "skipped": skipped, "failed": failed}


def apply_remote_task(task: DownloadTask, remote: dict[str, Any]) -> None:
    data = normalize_task(remote)
    task.status = data["status"]
    task.progress = data["progress"]
    if data["total_size"] > 0:
        task.total_size = data["total_size"]
    task.downloaded_size = int(task.total_size * task.progress / 100)
    # OpenList TaskInfo 没有独立速率字段，不从描述文本中猜测或沿用陈旧值。
    task.speed = None
    task.error_message = data["error_message"]
    if data["state"] == 3:
        task.error_message = "取消请求已提交，等待 OpenList 确认"


def sync_tasks(db: Session) -> list[DownloadTask]:
    tasks = (
        db.query(DownloadTask)
        .filter(
            DownloadTask.status.in_([TaskStatus.pending.value, TaskStatus.downloading.value]),
            DownloadTask.openlist_task_id.is_not(None),
        )
        .all()
    )
    if not tasks:
        return []
    updated = []
    with get_client(db) as client:
        remote = client.get_offline_tasks([task.openlist_task_id for task in tasks])
        by_id = {item["id"]: item for item in remote}
        for task in tasks:
            item = by_id.get(task.openlist_task_id)
            if item is None:
                try:
                    item = client.get_task(task.openlist_task_id)
                except OpenListError as exc:
                    if exc.code != 404:
                        raise
                    task.error_message = "OpenList 暂未找到该任务，请检查任务是否已被清理"
                    updated.append(task)
                    continue
            apply_remote_task(task, item)
            # 离线任务成功不代表独立转存任务已完成，番号库只接受实际扫描出的文件。
            updated.append(task)
        db.commit()
    return updated
