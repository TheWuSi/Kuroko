from pathlib import PurePosixPath
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.code import CodeRecord
from app.models.storage import StorageGroup
from app.models.task import DownloadTask, TaskStatus
from app.services.openlist_client import OpenListClient
from app.services.storage_service import choose_target, get_client
from app.utils.code_extractor import extract_code


def submit_batch(db: Session, tasks: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    submitted, skipped = [], []
    for item in tasks:
        existing = db.query(CodeRecord).filter(CodeRecord.code == item["code"]).first()
        if existing and not item.get("force", False):
            skipped.append({"code": item["code"], "reason": "already_exists", "existing_location": f"{existing.storage_path}/{existing.file_name}"})
            continue
        group_query = db.query(StorageGroup)
        target_group = item.get("target_group")
        group = group_query.filter(StorageGroup.id == int(target_group)).first() if isinstance(target_group, int) or (isinstance(target_group, str) and target_group.isdigit()) else group_query.filter(StorageGroup.name == target_group).first() if target_group else group_query.first()
        if group is None:
            raise ValueError("未找到目标存储分组")
        target_root, _ = choose_target(db, group, int(item.get("total_size", 0)))
        # 每个任务使用独立番号目录，避免同一挂载点的离线任务互相覆盖。
        target_path = str(PurePosixPath(target_root) / item["code"])
        client: OpenListClient = get_client(db)
        openlist_task_id = client.add_offline_download(item["magnet"], target_path)
        task = DownloadTask(code=item["code"], magnet=item["magnet"], target_path=target_path, openlist_task_id=openlist_task_id, total_size=int(item.get("total_size", 0)))
        db.add(task)
        db.flush()
        submitted.append({"code": task.code, "task_id": task.task_id, "target_path": task.target_path, "openlist_task_id": openlist_task_id})
    db.commit()
    return {"submitted": submitted, "skipped": skipped}


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return max(0, int(float(value)))
    except (TypeError, ValueError):
        return default


def _task_files(item: dict[str, Any], task: DownloadTask) -> list[dict[str, Any]]:
    """从 OpenList 任务元数据提取已落盘文件，兼容不同版本字段。"""
    candidates = item.get("files") or item.get("content") or item.get("file_list") or []
    if isinstance(candidates, dict):
        candidates = candidates.get("files") or candidates.get("content") or []
    if not isinstance(candidates, list):
        candidates = []
    files: list[dict[str, Any]] = []
    for raw in candidates:
        if isinstance(raw, str):
            files.append({"name": raw, "size": task.total_size})
            continue
        if not isinstance(raw, dict):
            continue
        name = raw.get("path") or raw.get("full_path") or raw.get("name") or raw.get("file_name")
        if name:
            files.append({"name": str(name), "size": _as_int(raw.get("size") or raw.get("length"), task.total_size)})
    if files:
        return files
    path = item.get("path") or item.get("save_path") or item.get("target_path")
    name = item.get("name") or item.get("file_name")
    if path and name:
        return [{"name": str(PurePosixPath(str(path)) / str(name)), "size": task.total_size}]
    # 某些 OpenList 版本只返回任务状态。仍然保存任务番号，避免完成事件丢失。
    return [{"name": str(PurePosixPath(task.target_path) / task.code), "size": task.total_size}]


def _record_completed_task(db: Session, task: DownloadTask, remote: dict[str, Any]) -> None:
    """完成事件只写入一次，避免后台轮询产生重复番号记录。"""
    for file in _task_files(remote, task):
        name = str(file["name"])
        path = str(PurePosixPath(name).parent)
        file_name = PurePosixPath(name).name
        code = extract_code(file_name) or task.code
        exists = db.query(CodeRecord).filter(
            CodeRecord.code == code,
            CodeRecord.storage_path == path,
            CodeRecord.file_name == file_name,
        ).first()
        if exists:
            continue
        try:
            with db.begin_nested():
                db.add(CodeRecord(code=code, storage_path=path, file_name=file_name, file_size=_as_int(file.get("size")), source="download"))
                db.flush()
        except IntegrityError:
            # 并发轮询时另一事务可能已先写入，幂等地忽略冲突。
            continue


def sync_tasks(db: Session) -> list[DownloadTask]:
    tasks = db.query(DownloadTask).filter(DownloadTask.status.in_([TaskStatus.pending.value, TaskStatus.downloading.value])).all()
    if not tasks:
        return []
    remote = get_client(db).get_offline_tasks([task.openlist_task_id for task in tasks if task.openlist_task_id])
    by_id = {str(item.get("id") or item.get("task_id")): item for item in remote}
    completed: list[DownloadTask] = []
    for task in tasks:
        item = by_id.get(str(task.openlist_task_id))
        if not item:
            continue
        status = str(item.get("status") or item.get("state") or "downloading").lower()
        task.status = TaskStatus.completed.value if status in {"success", "completed", "complete", "finished", "done"} else TaskStatus.failed.value if status in {"error", "failed", "failure", "cancelled"} else TaskStatus.downloading.value
        try:
            task.progress = min(100.0, max(0.0, float(item.get("progress", item.get("percent", task.progress)))))
        except (TypeError, ValueError):
            task.progress = task.progress
        task.speed = str(item.get("speed")) if item.get("speed") is not None else task.speed
        task.downloaded_size = _as_int(item.get("downloaded_size") or item.get("downloaded") or task.downloaded_size, task.downloaded_size)
        task.error_message = item.get("error") or item.get("error_message")
        if task.status == TaskStatus.completed.value:
            task.progress = 100.0
            _record_completed_task(db, task, item)
            completed.append(task)
    db.commit()
    return completed
