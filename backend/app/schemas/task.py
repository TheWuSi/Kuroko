from datetime import datetime

from pydantic import BaseModel, Field


class TaskOut(BaseModel):
    task_id: str
    openlist_task_id: str | None
    code: str
    magnet: str
    status: str
    progress: float
    speed: str | None
    target_path: str
    total_size: int
    downloaded_size: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class DeleteTaskQuery(BaseModel):
    delete_files: bool = False
