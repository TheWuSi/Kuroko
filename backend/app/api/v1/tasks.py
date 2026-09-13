from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import ApiError, success
from app.core.security import get_current_user
from app.models.task import DownloadTask, TaskStatus
from app.services.download_service import apply_remote_task, normalize_task, sync_tasks
from app.services.openlist_client import OpenListError
from app.services.storage_events import storage_events
from app.services.storage_service import get_client

router = APIRouter(prefix="/tasks", tags=["Tasks"], dependencies=[Depends(get_current_user)])


def task_data(task: DownloadTask) -> dict:
    return {
        "task_id": task.task_id,
        "openlist_task_id": task.openlist_task_id,
        "code": task.code,
        "variant": task.variant,
        "part_numbers": task.part_numbers,
        "magnet": task.magnet,
        "status": task.status,
        "progress": task.progress,
        "speed": task.speed,
        "target_path": task.target_path,
        "total_size": task.total_size,
        "downloaded_size": task.downloaded_size,
        "downloaded_size_is_estimate": True,
        "phase": "offline_download",
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
    }


@router.get("")
def list_tasks(
    status: TaskStatus | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(DownloadTask)
    if status:
        query = query.filter(DownloadTask.status == status.value)
    total = query.count()
    items = query.order_by(DownloadTask.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return success({"total": total, "page": page, "page_size": page_size, "items": [task_data(item) for item in items]})


@router.post("/sync")
def sync(db: Session = Depends(get_db)):
    try:
        updated = sync_tasks(db)
        return success(
            {
                "synced_count": len(updated),
                "completed_count": sum(task.status == TaskStatus.completed.value for task in updated),
                "updated_tasks": [task_data(task) for task in updated],
            }
        )
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/transfers")
def list_transfers(db: Session = Depends(get_db)):
    try:
        source_id = storage_events.current()["source_id"]
        with get_client(db) as client:
            tasks = client.get_offline_tasks(kind="offline_download_transfer")
        items = [
            {
                "task_id": item["id"],
                "name": item["name"],
                "phase": "offline_download_transfer",
                "start_time": item["start_time"],
                "end_time": item["end_time"],
                "downloaded_size_is_estimate": True,
                **normalize_task(item),
            }
            for item in tasks
        ]
        storage_events.observe_transfers(tasks, source_id)
        return success({"items": items})
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/transfers/{task_id}")
def cancel_transfer(task_id: str = Path(min_length=1, max_length=255), db: Session = Depends(get_db)):
    try:
        with get_client(db) as client:
            remote = normalize_task(client.get_task(task_id, kind="offline_download_transfer"))
            if remote["state"] in {2, 4, 7}:
                raise ApiError(409, 40901, "转存任务已结束")
            client.cancel_task(task_id, kind="offline_download_transfer")
        return success({"task_id": task_id, "cancel_requested": True, "deleted": False})
    except OpenListError as exc:
        status = 404 if exc.code == 404 else 502
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.get("/{task_id}")
def get_task(task_id: str = Path(min_length=1, max_length=255), db: Session = Depends(get_db)):
    task = db.query(DownloadTask).filter(DownloadTask.task_id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return success(task_data(task))


@router.delete("/{task_id}")
def cancel_task(
    task_id: str = Path(min_length=1, max_length=255),
    delete_files: bool = False,
    db: Session = Depends(get_db),
):
    if delete_files:
        raise ApiError(400, 40001, "此接口仅取消任务，文件删除请在 OpenList 中操作")
    task = db.query(DownloadTask).filter(DownloadTask.task_id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.status == TaskStatus.cancelled.value:
        return success({"task_id": task_id, "status": task.status, "cancel_requested": False, "deleted": False})
    if task.status in {TaskStatus.completed.value, TaskStatus.failed.value}:
        raise ApiError(409, 40901, "离线任务已结束；如需停止转存，请在转存任务中操作")
    if not task.openlist_task_id:
        raise ApiError(409, 40901, "任务提交结果尚未确认，请先在 OpenList 检查")
    try:
        with get_client(db) as client:
            apply_remote_task(task, client.get_task(task.openlist_task_id))
            if task.status in {TaskStatus.completed.value, TaskStatus.failed.value, TaskStatus.cancelled.value}:
                db.commit()
                storage_events.invalidate()
                raise ApiError(409, 40901, "OpenList 离线任务已结束")
            client.cancel_task(task.openlist_task_id)
        task.error_message = "取消请求已提交，等待 OpenList 确认"
        db.commit()
        return success({"task_id": task_id, "status": task.status, "cancel_requested": True, "deleted": False})
    except OpenListError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
