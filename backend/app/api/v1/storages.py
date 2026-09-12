from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.responses import success
from app.core.security import get_current_user
from app.models.code import DuplicateAllowance
from app.models.storage import StorageGroup, StorageGroupPath, StorageIgnore, StorageSpaceOverride
from app.schemas.storage import (
    SpaceOverrideRequest,
    StorageGroupRequest,
    StorageGroupUpdate,
    StorageIgnoreRequest,
    StorageMemberRequest,
)
from app.services.config_service import get_config, update_config
from app.services.openlist_client import OpenListError
from app.services.read_cache import openlist_read_cache
from app.services.storage_service import get_client, is_ignored_path, resolve_storage_path, storage_info
from app.utils.paths import child_path, join_path, normalize_path

router = APIRouter(tags=["Storage"], dependencies=[Depends(get_current_user)])


@router.get("/storages")
def list_storages(include_ignored: bool = False, refresh: bool = False, db: Session = Depends(get_db)):
    try:
        return success({"storages": storage_info(db, include_ignored=include_ignored, refresh=refresh)})
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/storages/ignored")
def list_ignored(db: Session = Depends(get_db)):
    return success(
        {
            "items": [
                {"storage_id": row.storage_id, "storage_mount": row.storage_mount}
                for row in db.query(StorageIgnore).order_by(StorageIgnore.storage_id)
            ]
        }
    )


@router.put("/storages/{storage_id}/ignore")
def set_ignored(payload: StorageIgnoreRequest, storage_id: int = Path(ge=1), db: Session = Depends(get_db)):
    row = db.get(StorageIgnore, storage_id)
    if payload.ignored and row is None:
        try:
            with get_client(db) as client:
                remote = client.get_storage_info()
            storage = next((item for item in remote if item["id"] == storage_id), None)
            if storage is None:
                raise HTTPException(status_code=404, detail="存储节点不存在")
            db.add(StorageIgnore(storage_id=storage_id, storage_mount=storage["mount_path"]))
        except OpenListError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    elif not payload.ignored and row is not None:
        db.delete(row)
    db.commit()
    openlist_read_cache.clear()
    return success({"storage_id": storage_id, "ignored": payload.ignored})


@router.get("/storages/{storage_id}/directories")
def list_directories(
    storage_id: int = Path(ge=1),
    path: str | None = Query(default=None, max_length=1024),
    refresh: bool = False,
    db: Session = Depends(get_db),
):
    try:
        with get_client(db) as client:
            remote = client.get_storage_info()
            storage = next((item for item in remote if item["id"] == storage_id), None)
            if storage is None:
                raise HTTPException(status_code=404, detail="存储节点不存在")
            current = normalize_path(path) if path is not None else storage["mount_path"]
            actual, _ = resolve_storage_path(current, remote)
            if actual["id"] != storage_id:
                raise ValueError("目录不属于所选存储节点，请先切换存储")
            if is_ignored_path(db, current, remote):
                raise ValueError("该存储已被忽略，请先在存储页面恢复")
            if storage["status"] != "work":
                raise ValueError("存储节点当前不可用")
            directories = []
            for entry in client.list_files(current, refresh=refresh):
                if entry["is_dir"]:
                    full_path = child_path(current, entry["name"])
                    owner, _ = resolve_storage_path(full_path, remote)
                    if owner["id"] == storage_id and not is_ignored_path(db, full_path, remote):
                        directories.append({"name": entry["name"], "path": full_path})
            return success({"path": current, "mount_path": storage["mount_path"], "directories": directories})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.put("/storages/{storage_id}/space")
def update_space(
    payload: SpaceOverrideRequest,
    storage_id: int = Path(ge=1),
    db: Session = Depends(get_db),
):
    try:
        with get_client(db) as client:
            remote = client.get_storage_info()
            storage = next((item for item in remote if item["id"] == storage_id), None)
            if storage is None:
                raise HTTPException(status_code=404, detail="存储节点不存在")
            row = (
                db.query(StorageSpaceOverride)
                .filter(StorageSpaceOverride.storage_mount == storage["mount_path"])
                .first()
            )
            if row is None:
                db.add(
                    StorageSpaceOverride(
                        storage_mount=storage["mount_path"], total_space_bytes=payload.total_space_bytes
                    )
                )
            else:
                row.total_space_bytes = payload.total_space_bytes
            db.commit()
            openlist_read_cache.clear()
            refreshed = storage_info(db, client=client, remote=remote, storage_id=storage_id, include_ignored=True)
            return success(next(item for item in refreshed if item["id"] == storage_id))
    except OpenListError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def group_data(group: StorageGroup) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "storage_paths": [join_path(item.storage_mount, item.folder_path) for item in group.paths],
        "members": [
            {
                "id": item.id,
                "storage_id": item.storage_id,
                "storage_mount": item.storage_mount,
                "download_path": join_path(item.storage_mount, item.folder_path),
                "archive_paths": [join_path(item.storage_mount, folder) for folder in (item.archive_folders or [])],
            }
            for item in group.paths
        ],
        "paths": [
            {
                "id": item.id,
                "storage_mount": item.storage_mount,
                "folder_path": item.folder_path,
                "storage_id": item.storage_id,
                "archive_folders": item.archive_folders or [],
            }
            for item in group.paths
        ],
        "created_at": group.created_at.isoformat(),
        "updated_at": group.updated_at.isoformat(),
    }


def resolve_group_members(
    db: Session,
    paths: list[str] | None,
    members: list[StorageMemberRequest] | None,
) -> list[StorageGroupPath]:
    try:
        with get_client(db) as client:
            storages = client.get_storage_info()
        result = []
        for path in paths or []:
            storage, folder = resolve_storage_path(path, storages)
            result.append(
                StorageGroupPath(
                    storage_id=storage["id"],
                    storage_mount=storage["mount_path"],
                    folder_path=folder,
                    archive_folders=[],
                )
            )
        for member in members or []:
            storage, download = resolve_storage_path(member.download_path, storages)
            if storage["id"] != member.storage_id:
                raise ValueError("下载目录不属于所选存储节点")
            if download == "/":
                raise ValueError("请为分组选择具体下载子目录，不可将整个挂载设为扫描范围")
            archives = []
            for path in member.archive_paths:
                owner, folder = resolve_storage_path(path, storages)
                if owner["id"] != member.storage_id or folder == "/":
                    raise ValueError("归档目录必须是所选存储节点内的具体子目录")
                archives.append(folder)
            result.append(
                StorageGroupPath(
                    storage_id=storage["id"],
                    storage_mount=storage["mount_path"],
                    folder_path=download,
                    archive_folders=list(dict.fromkeys(archives)),
                )
            )
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
    members = resolve_group_members(db, payload.storage_paths, payload.members)
    group = StorageGroup(name=payload.name)
    group.paths = members
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
    members = (
        resolve_group_members(db, payload.storage_paths, payload.members)
        if (payload.storage_paths is not None or payload.members is not None)
        else None
    )
    old_name = group.name
    if payload.storage_paths is not None and members is not None:
        # 旧客户端只更新下载路径，没有表达清空归档配置的意图，按节点保留已有归档目录。
        for member in members:
            member.archive_folders = list(
                dict.fromkeys(
                    folder
                    for old in group.paths
                    if old.storage_mount == member.storage_mount
                    for folder in (old.archive_folders or [])
                )
            )
    if payload.name is not None:
        group.name = payload.name
    try:
        if members is not None:
            group.paths.clear()
            # 删除旧路径后再插入，避免相同路径触发唯一约束。
            db.flush()
            group.paths = members
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="分组名称或路径重复") from exc
    db.refresh(group)
    probes = get_config(db, masked=False).get("probe_paths", [])
    if any(item.get("group_name") == old_name for item in probes):
        # 显式保存成员目录后不再继续扫描旧配置；单纯改名则保留探测路径归属。
        probes = [
            {**item, "group_name": group.name} if item.get("group_name") == old_name else item
            for item in probes
            if not (payload.members is not None and item.get("group_name") == old_name)
        ]
        update_config(db, {"probe_paths": probes})
    return success(group_data(group))


@router.delete("/storage-groups/{group_id}")
def delete_group(group_id: int = Path(ge=1), db: Session = Depends(get_db)):
    group = db.get(StorageGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    db.query(DuplicateAllowance).filter(DuplicateAllowance.group_id == group_id).delete()
    db.delete(group)
    db.commit()
    return success({"id": group_id, "deleted": True})
