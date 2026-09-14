"""磁力后台任务与账号历史接口。"""

from contextlib import contextmanager
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.magnet_job import MagnetParseItem, MagnetParseJob, MagnetSubmission
from app.models.user import User
from app.schemas.magnet import ParseJobRequest, ResumeParseRequest, SubmissionRequest
from app.services.magnet_jobs import (
    ACTIVE,
    JobConflictError,
    cancel_parse,
    create_parse_job,
    create_submission,
    resume_parse,
    serialize_job,
    serialize_submission,
)

router = APIRouter(prefix="/magnets", tags=["Magnet jobs"])


@contextmanager
def job_errors():
    try:
        yield
    except JobConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def owned_job(db: Session, job_id: UUID, user_id: int) -> MagnetParseJob:
    job = db.get(MagnetParseJob, str(job_id))
    if job is None or job.user_id != user_id:
        raise HTTPException(404, "解析批次不存在")
    return job


@router.post("/parse-jobs", status_code=202)
def start_parse_job(payload: ParseJobRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    with job_errors():
        return success(serialize_job(db, create_parse_job(db, user.id, payload)))


@router.get("/parse-jobs")
def list_parse_jobs(
    active: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    request_id: UUID | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(MagnetParseJob).filter_by(user_id=user.id)
    if request_id is not None:
        query = query.filter_by(request_id=str(request_id))
    if active:
        query = query.filter(MagnetParseJob.status.in_(ACTIVE))
    total = query.count()
    jobs = (
        query.order_by(MagnetParseJob.created_at.desc(), MagnetParseJob.job_id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return success({"total": total, "items": [serialize_job(db, job, detail=False) for job in jobs]})


@router.get("/parse-jobs/{job_id}")
def get_parse_job(job_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return success(serialize_job(db, owned_job(db, job_id, user.id)))


@router.get("/parse-jobs/{job_id}/items/{index}")
def get_parse_item(
    job_id: UUID,
    index: int = Path(ge=0, le=99),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owned_job(db, job_id, user.id)
    item = db.get(MagnetParseItem, (str(job_id), index))
    if item is None:
        raise HTTPException(404, "解析条目不存在")
    return success({"index": item.index, "attempt": item.attempt, "status": item.status, "result": item.result})


@router.post("/parse-jobs/{job_id}/cancel")
def stop_parse_job(job_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = owned_job(db, job_id, user.id)
    cancel_parse(db, job)
    return success(serialize_job(db, job))


@router.post("/parse-jobs/{job_id}/resume", status_code=202)
def continue_parse_job(
    job_id: UUID,
    payload: ResumeParseRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = owned_job(db, job_id, user.id)
    with job_errors():
        resume_parse(db, job, payload.indices)
    return success(serialize_job(db, job))


@router.post("/parse-jobs/{job_id}/submissions", status_code=202)
def start_submission(
    job_id: UUID,
    payload: SubmissionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    job = owned_job(db, job_id, user.id)
    with job_errors():
        return success(serialize_submission(db, create_submission(db, job, payload)))


@router.get("/submissions")
def list_submissions(
    active: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    request_id: UUID | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(MagnetSubmission).filter_by(user_id=user.id)
    if request_id is not None:
        query = query.filter_by(request_id=str(request_id))
    if active:
        query = query.filter(MagnetSubmission.status.in_(ACTIVE))
    total = query.count()
    submissions = (
        query.order_by(MagnetSubmission.created_at.desc(), MagnetSubmission.submission_id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return success({"total": total, "items": [serialize_submission(db, row, detail=False) for row in submissions]})


@router.get("/submissions/{submission_id}")
def get_submission(submission_id: UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    submission = db.get(MagnetSubmission, str(submission_id))
    if submission is None or submission.user_id != user.id:
        raise HTTPException(404, "提交记录不存在")
    return success(serialize_submission(db, submission))
