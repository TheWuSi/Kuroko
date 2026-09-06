from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.storage import StorageGroup, StorageGroupPath, StorageSpaceOverride
from app.schemas.storage import SpaceOverrideRequest, StorageGroupRequest, StorageGroupUpdate
from app.services.storage_service import storage_info
from app.services.openlist_client import OpenListError

router = APIRouter(tags=["Storage"], dependencies=[Depends(get_current_user)])


@router.get("/storages")
def list_storages(db: Session = Depends(get_db)):
    try:
        return success({"storages": storage_info(db)})
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/storages/{storage_id}/space")
def update_space(storage_id: int, payload: SpaceOverrideRequest, db: Session = Depends(get_db)):
    # OpenList 节点 ID 是运行时枚举值，使用请求体中的 mount_path 扩展时再持久化；此处将 ID 解析为当前节点。
    try:
        storage = storage_info(db)[storage_id - 1]
    except (IndexError, OpenListError) as exc:
        raise HTTPException(status_code=404, detail="存储节点不存在") from exc
    row = db.query(StorageSpaceOverride).filter(StorageSpaceOverride.storage_mount == storage["mount_path"]).one_or_none()
    if row is None:
        row = StorageSpaceOverride(storage_mount=storage["mount_path"], total_space_bytes=payload.total_space_bytes)
        db.add(row)
    else:
        row.total_space_bytes = payload.total_space_bytes
    db.commit()
    return success({**storage, "total_space": payload.total_space_bytes, "space_source": "manual"})


def group_data(group: StorageGroup) -> dict:
    return {"id": group.id, "name": group.name, "storage_paths": [f"{item.storage_mount}{item.folder_path}" for item in group.paths], "created_at": group.created_at.isoformat(), "updated_at": group.updated_at.isoformat()}


@router.get("/storage-groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.query(StorageGroup).options(joinedload(StorageGroup.paths)).order_by(StorageGroup.id).all()
    return success({"groups": [group_data(group) for group in groups]})


@router.post("/storage-groups", status_code=201)
def create_group(payload: StorageGroupRequest, db: Session = Depends(get_db)):
    if db.query(StorageGroup).filter(StorageGroup.name == payload.name).first():
        raise HTTPException(status_code=409, detail="分组名称已存在")
    group = StorageGroup(name=payload.name)
    db.add(group)
    db.flush()
    for path in payload.storage_paths:
        mount, folder = split_path(path)
        group.paths.append(StorageGroupPath(storage_mount=mount, folder_path=folder))
    db.commit()
    db.refresh(group)
    return success(group_data(group))


@router.put("/storage-groups/{group_id}")
def update_group(group_id: int, payload: StorageGroupUpdate, db: Session = Depends(get_db)):
    group = db.query(StorageGroup).options(joinedload(StorageGroup.paths)).get(group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    if payload.name is not None:
        group.name = payload.name
    if payload.storage_paths is not None:
        group.paths.clear()
        for path in payload.storage_paths:
            mount, folder = split_path(path)
            group.paths.append(StorageGroupPath(storage_mount=mount, folder_path=folder))
    db.commit()
    db.refresh(group)
    return success(group_data(group))


@router.delete("/storage-groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    group = db.get(StorageGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    db.delete(group)
    db.commit()
    return success({"id": group_id, "deleted": True})


def split_path(path: str) -> tuple[str, str]:
    parts = path.strip("/").split("/", 1)
    mount = "/" + parts[0]
    folder = "/" + parts[1] if len(parts) == 2 else "/"
    return mount, folder
