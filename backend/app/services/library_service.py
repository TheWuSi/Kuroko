"""统一番号库的目录归属、跨盘查重和版本放行，供扫描、解析及提交共用。"""

from collections import Counter, defaultdict
from typing import Any

from sqlalchemy import false, func, or_
from sqlalchemy.orm import Session

from app.models.code import CodeRecord, DuplicateAllowance
from app.models.storage import StorageGroup
from app.models.task import DownloadTask
from app.services.storage_service import group_directories, group_roots, ignored_mounts, is_ignored_path
from app.utils.code_extractor import canonical_code, extract_part_number
from app.utils.paths import is_within, normalize_path


def path_condition(column, roots: list[str]):
    return (
        or_(*[or_(column == root, column.startswith(root.rstrip("/") + "/", autoescape=True)) for root in roots])
        if roots
        else false()
    )


def code_query(db: Session, group: StorageGroup | None = None):
    query = db.query(CodeRecord)
    if group is not None:
        query = query.filter(path_condition(CodeRecord.storage_path, group_roots(db, group)))
    hidden = ignored_mounts(db)
    if hidden:
        query = query.filter(~path_condition(CodeRecord.storage_path, hidden))
    return query


def find_group(db: Session, target: str | int | None) -> StorageGroup:
    query = db.query(StorageGroup)
    if isinstance(target, int) or (isinstance(target, str) and target.isdigit()):
        query = query.filter(StorageGroup.id == int(target))
    elif target:
        query = query.filter(StorageGroup.name == target)
    group = query.order_by(StorageGroup.id).first()
    if group is None:
        raise ValueError("未找到目标存储分组，请选择下载目录或创建分组")
    return group


def target_groups(
    db: Session,
    target_group: str | int | None = None,
    target_path: str | None = None,
) -> list[StorageGroup]:
    selected = find_group(db, target_group) if target_group is not None else None
    if target_path is None:
        return [selected] if selected else []
    target_path = normalize_path(target_path)
    if is_ignored_path(db, target_path):
        raise ValueError("下载目标所在存储已被忽略")
    groups = [
        group
        for group in db.query(StorageGroup).order_by(StorageGroup.id)
        if any(is_within(target_path, root) for root in group_roots(db, group))
    ]
    if selected is not None and all(group.id != selected.id for group in groups):
        raise ValueError("指定下载目录不在所选分组的目录范围内")
    return groups


def serialize_code(row: CodeRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "code": row.code,
        "variant": row.variant,
        "part_number": record_part(row),
        "storage_path": row.storage_path,
        "file_name": row.file_name,
        "file_size": row.file_size,
        "source": row.source,
        "discovered_at": row.discovered_at.isoformat(),
    }


def record_part(row: CodeRecord) -> int | None:
    return row.part_number if row.part_number is not None else extract_part_number(
        row.storage_path + "/" + row.file_name, row.code
    )


def copy_counts(code: str, rows: list[CodeRecord], tasks: list[DownloadTask] | None = None) -> Counter:
    counts = Counter((row.variant, record_part(row)) for row in rows)
    for task in tasks or []:
        # 旧任务或元数据降级时无法证明只下载某一集，用未知身份保守占位。
        parts = task.part_numbers if code.startswith("FC2-PPV-") else None
        counts.update((task.variant, part) for part in (parts or [None]))
    return counts


def has_same_copy(counts: Counter) -> bool:
    return any(count > 1 for count in counts.values()) or any(
        part is not None and (variant, None) in counts for variant, part in counts
    )


def duplicate_decision(
    db: Session,
    code: str,
    variant: str = "original",
    *,
    part_numbers: list[int] | None = None,
    target_group: str | int | None = None,
    target_path: str | None = None,
) -> dict[str, Any]:
    code = canonical_code(code)
    groups = target_groups(db, target_group, target_path)
    scopes = [(group, group_roots(db, group)) for group in groups]
    if not groups and target_path:
        scopes = [(None, [normalize_path(target_path)])]
    found = blocked = False
    existing_location = None
    for group, roots in scopes:
        if code == "UNKNOWN":
            # 没有识别出番号的磁力仅按 Hash 防重，不能把互不相关的未知作品视作同一番号。
            continue
        records = code_query(db, group).filter(CodeRecord.code == code)
        if group is None:
            records = records.filter(path_condition(CodeRecord.storage_path, roots))
        rows = records.all()
        active = db.query(DownloadTask).filter(
            DownloadTask.code == code,
            DownloadTask.status.in_(["pending", "downloading"]),
            path_condition(DownloadTask.target_path, roots),
        )
        hidden = ignored_mounts(db)
        if hidden:
            active = active.filter(~path_condition(DownloadTask.target_path, hidden))
        tasks = active.all()
        if not rows and not tasks:
            continue
        found = True
        existing_location = existing_location or (
            f"{rows[0].storage_path.rstrip('/')}/{rows[0].file_name}" if rows else tasks[0].target_path
        )
        counts = copy_counts(code, rows, tasks)
        variants = {version for version, _ in counts}
        allowance = db.query(DuplicateAllowance).filter_by(group_id=group.id, code=code).first() if group else None
        separate_parts = (
            code.startswith("FC2-PPV-") and bool(part_numbers)
            and (variant, None) not in counts
            and all((variant, part) not in counts for part in part_numbers)
        )
        # 同版本的不同分集自然共存；跨版本仍须批准组合，且任何一集都不能因此保留重复副本。
        versions_allowed = variants | {variant} == {variant} or (
            allowance is not None and variants | {variant} <= set(allowance.variants)
        )
        allowed = not has_same_copy(counts) and versions_allowed and (variant not in variants or separate_parts)
        blocked = blocked or not allowed
    return {
        "exists_in_library": found,
        "duplicate_blocked": blocked,
        "duplicate_allowed": found and not blocked,
        "existing_location": existing_location,
        "scope_group_ids": [group.id for group in groups],
        "dedup_scope": "group" if groups else "directory" if target_path else "unselected",
    }


def list_duplicates(db: Session, group_id: int | None = None, *, include_allowed: bool = False) -> list[dict]:
    groups = (
        [find_group(db, group_id)] if group_id is not None else db.query(StorageGroup).order_by(StorageGroup.id).all()
    )
    result = []
    for group in groups:
        directories = group_directories(db, group)
        query = code_query(db, group)
        duplicates = query.with_entities(CodeRecord.code).group_by(CodeRecord.code).having(func.count() > 1)
        by_code = defaultdict(list)
        for row in query.filter(CodeRecord.code.in_(duplicates)).order_by(CodeRecord.code, CodeRecord.id):
            by_code[row.code].append(row)
        allowances = {row.code: row for row in db.query(DuplicateAllowance).filter_by(group_id=group.id)}
        for code, rows in by_code.items():
            counts = copy_counts(code, rows)
            variants = sorted({variant for variant, _ in counts})
            rule = allowances.get(code)
            same_version = has_same_copy(counts)
            if not same_version and len(variants) == 1:
                continue
            allowed = not same_version and rule is not None and set(variants) <= set(rule.variants)
            if allowed and not include_allowed:
                continue
            result.append(
                {
                    "group_id": group.id,
                    "group_name": group.name,
                    "code": code,
                    "variants": variants,
                    "allowed_variants": rule.variants if rule else [],
                    "ignored": allowed,
                    "can_ignore": not same_version,
                    "reason": "same_version" if same_version else "version_combination",
                    "files": [serialize_duplicate_file(row, directories) for row in rows],
                }
            )
    return result


def serialize_duplicate_file(row: CodeRecord, directories: list[dict]) -> dict:
    matches = [item for item in directories if is_within(row.storage_path, item["path"])]
    length = max((len(item["path"]) for item in matches), default=0)
    return {**serialize_code(row), "directory_matches": [item for item in matches if len(item["path"]) == length]}
