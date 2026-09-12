from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.storage import StorageGroup, StorageGroupPath, StorageSpaceOverride
from app.schemas.storage import SpaceOverrideRequest, StorageGroupRequest, StorageGroupUpdate
from app.services.openlist_client import OpenListError
from app.services.storage_service import get_client, resolve_storage_path, storage_info
from app.utils.paths import join_path

router = APIRouter(tags=["Storage"], dependencies=[Depends(get_current_user)])


@router.get("/storages")
def list_storages(db: Session = Depends(get_db)):
    try:
        return success({"storages": storage_info(db)})
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/storages/{storage_id}/space")
def update_space(
    payload: SpaceOverrideRequest, storage_id: int = Path(ge=1), db: Session = Depends(get_db),
):
    try:
        with get_client(db) as client:
            remote = client.get_storage_info()
            storage = next((item for item in remote if item["id"] == storage_id), None)
            if storage is None:
                raise HTTPException(status_code=404, detail="存储节点不存在")
            row = db.query(StorageSpaceOverride).filter(StorageSpaceOverride.storage_mount == storage["mount_path"]).first()
            if row is None:
                db.add(StorageSpaceOverride(storage_mount=storage["mount_path"], total_space_bytes=payload.total_space_bytes))
            else:
                row.total_space_bytes = payload.total_space_bytes
            db.commit()
            refreshed = storage_info(db, client=client, remote=remote)
            return success(next(item for item in refreshed if item["id"] == storage_id))
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def group_data(group: StorageGroup) -> dict:
    return {
        "id": group.id, "name": group.name,
        "storage_paths": [join_path(item.storage_mount, item.folder_path) for item in group.paths],
        "paths": [{
            "id": item.id, "storage_mount": item.storage_mount, "folder_path": item.folder_path,
        } for item in group.paths],
        "created_at": group.created_at.isoformat(), "updated_at": group.updated_at.isoformat(),
    }


def resolve_group_paths(db: Session, paths: list[str]) -> list[tuple[str, str]]:
    try:
        with get_client(db) as client:
            storages = client.get_storage_info()
        result = []
        for path in paths:
            storage, folder = resolve_storage_path(path, storages)
            result.append((storage["mount_path"], folder))
        return result
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/storage-groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.query(StorageGroup).options(joinedload(StorageGroup.paths)).order_by(StorageGroup.id).all()
    return success({"groups": [group_data(group) for group in groups]})


@router.post("/storage-groups", status_code=201)
def create_group(payload: StorageGroupRequest, db: Session = Depends(get_db)):
    if db.query(StorageGroup).filter(StorageGroup.name == payload.name).first():
        raise HTTPException(status_code=409, detail="分组名称已存在")
    paths = resolve_group_paths(db, payload.storage_paths)
    group = StorageGroup(name=payload.name)
    group.paths = [StorageGroupPath(storage_mount=mount, folder_path=folder) for mount, folder in paths]
    db.add(group)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="分组名称或路径重复") from exc
    db.refresh(group)
    return success(group_data(group))


@router.put("/storage-groups/{group_id}")
def update_group(payload: StorageGroupUpdate, group_id: int = Path(ge=1), db: Session = Depends(get_db)):
    group = db.query(StorageGroup).options(joinedload(StorageGroup.paths)).filter(StorageGroup.id == group_id).first()
    if group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    paths = resolve_group_paths(db, payload.storage_paths) if payload.storage_paths is not None else None
    if payload.name is not None:
        group.name = payload.name
    try:
        if paths is not None:
            group.paths.clear()
            # 删除旧路径后再插入，避免相同路径触发唯一约束。
            db.flush()
            group.paths = [StorageGroupPath(storage_mount=mount, folder_path=folder) for mount, folder in paths]
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="分组名称或路径重复") from exc
    db.refresh(group)
    return success(group_data(group))


@router.delete("/storage-groups/{group_id}")
def delete_group(group_id: int = Path(ge=1), db: Session = Depends(get_db)):
    group = db.get(StorageGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    db.delete(group)
    db.commit()
    return success({"id": group_id, "deleted": True})
