from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.code import CodeRecord, DuplicateAllowance
from app.models.config import ScanJob
from app.models.storage import StorageGroup
from app.schemas.code import DuplicateAllowanceRequest, ScanRequest
from app.services.code_service import (
    ScanBusyError,
    configured_scan_roots,
    create_scan_job,
    run_scan,
    serialize_scan_job,
)
from app.services.library_service import code_query, list_duplicates, serialize_code
from app.utils.code_extractor import canonical_code

router = APIRouter(prefix="/codes", tags=["Codes"], dependencies=[Depends(get_current_user)])


def require_group(db: Session, group_id: int | None) -> StorageGroup | None:
    group = db.get(StorageGroup, group_id) if group_id is not None else None
    if group_id is not None and group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    return group


@router.get("")
def list_codes(
    group_id: int | None = Query(default=None, ge=1),
    search: str | None = Query(default=None, max_length=64),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = code_query(db, require_group(db, group_id))
    if search:
        query = query.filter(CodeRecord.code.contains(canonical_code(search), autoescape=True))
    total = query.count()
    rows = (
        query.order_by(CodeRecord.discovered_at.desc(), CodeRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return success(
        {"total": total, "page": page, "page_size": page_size, "items": [serialize_code(row) for row in rows]}
    )


@router.get("/duplicates")
def duplicates(
    group_id: int | None = Query(default=None, ge=1),
    include_ignored: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    require_group(db, group_id)
    items = list_duplicates(db, group_id, include_allowed=include_ignored)
    return success({"total": len(items), "items": items[(page - 1) * page_size : page * page_size]})


@router.get("/duplicate-ignores")
def duplicate_ignores(group_id: int | None = Query(default=None, ge=1), db: Session = Depends(get_db)):
    require_group(db, group_id)
    query = db.query(DuplicateAllowance, StorageGroup.name).join(StorageGroup)
    if group_id is not None:
        query = query.filter(DuplicateAllowance.group_id == group_id)
    return success(
        {
            "items": [
                {"id": row.id, "group_id": row.group_id, "group_name": name, "code": row.code, "variants": row.variants}
                for row, name in query.order_by(DuplicateAllowance.id)
            ]
        }
    )


@router.put("/duplicate-ignores")
def allow_duplicate(payload: DuplicateAllowanceRequest, db: Session = Depends(get_db)):
    require_group(db, payload.group_id)
    row = db.query(DuplicateAllowance).filter_by(group_id=payload.group_id, code=payload.code).first()
    if row is None:
        row = DuplicateAllowance(group_id=payload.group_id, code=payload.code, variants=payload.variants)
        db.add(row)
    else:
        row.variants = payload.variants
    db.commit()
    return success({"id": row.id, "group_id": row.group_id, "code": row.code, "variants": row.variants})


@router.delete("/duplicate-ignores/{rule_id}")
def revoke_duplicate(rule_id: int = Path(ge=1), db: Session = Depends(get_db)):
    row = db.get(DuplicateAllowance, rule_id)
    if row is None:
        raise HTTPException(status_code=404, detail="放行规则不存在")
    db.delete(row)
    db.commit()
    return success({"id": rule_id, "deleted": True})


@router.get("/scan/paths")
def scan_paths(group_id: int | None = Query(default=None, ge=1), db: Session = Depends(get_db)):
    require_group(db, group_id)
    try:
        return success({"paths": configured_scan_roots(db, group_id)})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/scan")
def start_scan(payload: ScanRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    require_group(db, payload.group_id)
    try:
        job = create_scan_job(db, payload.group_id)
    except ScanBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    background_tasks.add_task(run_scan, job.task_id)
    return success({"task_id": job.task_id, "status": job.status, "group_id": job.group_id})


@router.get("/scan/status")
def scan_status(task_id: str | None = Query(default=None, max_length=64), db: Session = Depends(get_db)):
    query = db.query(ScanJob).order_by(ScanJob.started_at.desc(), ScanJob.id.desc())
    job = query.filter(ScanJob.task_id == task_id).first() if task_id else query.first()
    if job is None:
        raise HTTPException(status_code=404, detail="扫描任务不存在")
    return success(serialize_scan_job(job))


@router.delete("/{code}")
def delete_code(
    code: str = Path(min_length=1, max_length=64),
    group_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
):
    rows = code_query(db, require_group(db, group_id)).filter(CodeRecord.code == canonical_code(code)).all()
    if not rows:
        raise HTTPException(status_code=404, detail="番号不存在")
    for row in rows:
        db.delete(row)
    db.commit()
    return success({"code": canonical_code(code), "deleted": True})
