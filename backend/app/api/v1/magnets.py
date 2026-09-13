from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.schemas.magnet import BatchDownloadRequest, DuplicateCheckRequest, MagnetParseRequest
from app.services.download_service import submit_batch
from app.services.library_service import duplicate_decision
from app.services.magnet_service import parse_magnets
from app.services.openlist_client import OpenListError

router = APIRouter(prefix="/magnets", tags=["Magnets"], dependencies=[Depends(get_current_user)])


@router.post("/parse")
def parse(payload: MagnetParseRequest, db: Session = Depends(get_db)):
    try:
        return success(
            {
                "results": parse_magnets(
                    db,
                    payload.magnet_links,
                    target_group=payload.target_group,
                    target_path=payload.target_path,
                )
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/check-duplicates")
def check_duplicates(payload: DuplicateCheckRequest, db: Session = Depends(get_db)):
    try:
        return success(
            {
                "items": [
                    duplicate_decision(
                        db, item.code, item.variant, part_numbers=item.part_numbers,
                        target_group=payload.target_group, target_path=payload.target_path
                    )
                    for item in payload.items
                ]
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/batch-download")
def batch_download(payload: BatchDownloadRequest, db: Session = Depends(get_db)):
    try:
        return success(submit_batch(db, [item.model_dump() for item in payload.tasks]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
