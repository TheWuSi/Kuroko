"""补充分组目录、版本标识和持久化忽略规则。"""

import json
import re
from urllib.parse import parse_qs, urlsplit

import sqlalchemy as sa

from alembic import op

revision = "0002_library_scopes"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _code(value: str) -> str:
    return re.sub(r"^FC2(?:[-_ ]?PPV)?[-_ ]?(\d+)$", r"FC2-PPV-\1", value.upper())


def _variant(value: str) -> str:
    match = re.search(r"\d[-_ ](UC|C|U)(?![A-Z0-9])", value, re.IGNORECASE)
    return match.group(1).upper() if match else "original"


def upgrade() -> None:
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())

    def add_column(table, column):
        if column.name not in {item["name"] for item in sa.inspect(connection).get_columns(table)}:
            op.add_column(table, column)

    # 旧进程可能已通过 create_all 建立新增表，但没有给旧表补列；逐项检查兼容这种混合状态。
    add_column("storage_group_paths", sa.Column("storage_id", sa.Integer(), nullable=True))
    add_column("storage_group_paths", sa.Column("archive_folders", sa.JSON(), nullable=False, server_default="[]"))
    for table in ("code_records", "download_tasks"):
        add_column(table, sa.Column("variant", sa.String(16), nullable=False, server_default="original"))
    add_column("scan_jobs", sa.Column("duplicates_found", sa.Integer(), nullable=False, server_default="0"))
    if "storage_ignores" not in tables:
        op.create_table(
            "storage_ignores",
            sa.Column("storage_id", sa.Integer(), primary_key=True, autoincrement=False),
            sa.Column("storage_mount", sa.String(1024), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if "duplicate_allowances" not in tables:
        op.create_table(
            "duplicate_allowances",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("storage_groups.id", ondelete="CASCADE"), nullable=False),
            sa.Column("code", sa.String(64), nullable=False),
            sa.Column("variants", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("group_id", "code"),
        )
    # create_all 的旧库已有索引；由 0001 新建的库则需补齐关键查询索引。
    for table, column in (
        ("duplicate_allowances", "group_id"),
        ("code_records", "code"),
        ("storage_group_paths", "group_id"),
        ("download_tasks", "code"),
        ("download_tasks", "status"),
        ("download_tasks", "openlist_task_id"),
    ):
        name = f"ix_{table}_{column}"
        if name not in {index["name"] for index in sa.inspect(connection).get_indexes(table)}:
            op.create_index(name, table, [column])
    records = (
        connection.execute(sa.text("SELECT id, code, variant, storage_path, file_name FROM code_records"))
        .mappings()
        .all()
    )
    for row in records:
        code = _code(row["code"])
        # FC2 两种旧拼写若指向同一物理文件，仅保留已有规范记录，不修改任何实际文件。
        duplicate = connection.execute(
            sa.text(
                "SELECT id FROM code_records WHERE code=:code AND storage_path=:path AND file_name=:name AND id!=:id"
            ),
            {"code": code, "path": row["storage_path"], "name": row["file_name"], "id": row["id"]},
        ).first()
        if duplicate:
            connection.execute(sa.text("DELETE FROM code_records WHERE id=:id"), {"id": row["id"]})
        else:
            connection.execute(
                sa.text("UPDATE code_records SET code=:code, variant=:variant WHERE id=:id"),
                {
                    "id": row["id"],
                    "code": code,
                    "variant": row["variant"]
                    if row["variant"] != "original"
                    else _variant(row["storage_path"] + "/" + row["file_name"]),
                },
            )
    for row in connection.execute(sa.text("SELECT id, code, variant, magnet FROM download_tasks")).mappings().all():
        try:
            name = parse_qs(urlsplit(row["magnet"]).query).get("dn", [""])[0]
        except ValueError:
            name = ""
        connection.execute(
            sa.text("UPDATE download_tasks SET code=:code, variant=:variant, magnet=:magnet WHERE id=:id"),
            {
                "id": row["id"],
                "code": _code(row["code"]),
                "variant": row["variant"] if row["variant"] != "original" else _variant(name),
                "magnet": re.sub(r"([?&]xt=)urn%3Abtih%3A", r"\1urn:btih:", row["magnet"], flags=re.IGNORECASE),
            },
        )
    _migrate_probe_paths(connection)


def _migrate_probe_paths(connection) -> None:
    row = connection.execute(sa.text("SELECT id, value FROM system_configs WHERE key='probe_paths'")).mappings().first()
    if not row:
        return
    try:
        probes = json.loads(row["value"])
    except (ValueError, TypeError):
        return
    if not isinstance(probes, list):
        return
    remaining = []
    for probe in probes:
        if not isinstance(probe, dict) or not isinstance(probe.get("paths"), list):
            remaining.append(probe)
            continue
        unmatched = []
        for path in probe["paths"]:
            members = (
                connection.execute(
                    sa.text(
                        "SELECT p.id, p.folder_path, p.archive_folders FROM storage_group_paths p "
                        "JOIN storage_groups g ON g.id=p.group_id WHERE g.name=:name AND p.storage_mount=:mount"
                    ),
                    {"name": probe.get("group_name"), "mount": path.get("storage_mount")},
                )
                .mappings()
                .all()
                if isinstance(path, dict)
                else []
            )
            folder = path.get("folder", "/") if isinstance(path, dict) else None
            if not members or not isinstance(folder, str) or not folder.startswith("/") or ".." in folder.split("/"):
                unmatched.append(path)
                continue
            for member in members:
                archives = json.loads(member["archive_folders"])
                if folder != member["folder_path"] and folder not in archives:
                    archives.append(folder)
                connection.execute(
                    sa.text("UPDATE storage_group_paths SET archive_folders=:folders WHERE id=:id"),
                    {"id": member["id"], "folders": json.dumps(archives, ensure_ascii=False)},
                )
        if unmatched:
            remaining.append({**probe, "paths": unmatched})
    connection.execute(
        sa.text("UPDATE system_configs SET value=:value WHERE id=:id"),
        {"id": row["id"], "value": json.dumps(remaining, ensure_ascii=False)},
    )


def downgrade() -> None:
    op.drop_table("duplicate_allowances")
    op.drop_table("storage_ignores")
    op.drop_column("scan_jobs", "duplicates_found")
    for table in ("download_tasks", "code_records"):
        op.drop_column(table, "variant")
    op.drop_column("storage_group_paths", "archive_folders")
    op.drop_column("storage_group_paths", "storage_id")
