from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.task import DownloadTask, TaskStatus
from app.services.download_service import sync_tasks
from app.services.storage_service import get_client
from app.services.openlist_client import OpenListError

router = APIRouter(prefix="/tasks", tags=["Tasks"], dependencies=[Depends(get_current_user)])


def task_data(task: DownloadTask) -> dict:
    return {"task_id": task.task_id, "openlist_task_id": task.openlist_task_id, "code": task.code, "magnet": task.magnet, "status": task.status, "progress": task.progress, "speed": task.speed, "target_path": task.target_path, "total_size": task.total_size, "downloaded_size": task.downloaded_size, "error_message": task.error_message, "created_at": task.created_at.isoformat(), "updated_at": task.updated_at.isoformat()}


@router.get("")
def list_tasks(status: str | None = Query(default=None), page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = db.query(DownloadTask)
    if status:
        query = query.filter(DownloadTask.status == status)
    total = query.count()
    items = query.order_by(DownloadTask.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return success({"total": total, "page": page, "page_size": page_size, "items": [task_data(item) for item in items]})


@router.post("/sync")
def sync(db: Session = Depends(get_db)):
    try:
        updated = sync_tasks(db)
        return success({"synced_count": len(updated), "updated_tasks": [task_data(task) for task in updated]})
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(DownloadTask).filter(DownloadTask.task_id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return success(task_data(task))


@router.delete("/{task_id}")
def cancel_task(task_id: str, delete_files: bool = False, db: Session = Depends(get_db)):
    task = db.query(DownloadTask).filter(DownloadTask.task_id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    try:
        if task.openlist_task_id:
            get_client(db).cancel_task(task.openlist_task_id)
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    task.status = TaskStatus.cancelled.value
    db.commit()
    return success({"task_id": task_id, "status": task.status, "deleted": delete_files})
