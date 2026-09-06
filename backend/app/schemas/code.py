from pydantic import BaseModel, Field


class ScanRequest(BaseModel):
    group_id: int | None = Field(default=None, ge=1)


class CodeOut(BaseModel):
    code: str
    storage_path: str
    file_name: str
    file_size: int
    discovered_at: str


class ScanJobOut(BaseModel):
    task_id: str
    status: str
    scanned_files: int
    new_codes_found: int
    current_path: str | None
    progress_percent: float
    started_at: str
    completed_at: str | None
    error_message: str | None
