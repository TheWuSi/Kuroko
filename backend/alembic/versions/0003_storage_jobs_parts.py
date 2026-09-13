"""增加节点优先级、可取消扫描及 FC2 分集身份。"""

import sqlalchemy as sa

from alembic import op
from app.utils.code_extractor import extract_part_number, extract_variant

revision = "0003_storage_jobs_parts"
down_revision = "0002_library_scopes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()

    def add_column(table, column):
        if column.name not in {item["name"] for item in sa.inspect(connection).get_columns(table)}:
            op.add_column(table, column)

    add_column("storage_group_paths", sa.Column("priority", sa.Integer(), nullable=False, server_default="0"))
    add_column("code_records", sa.Column("part_number", sa.Integer(), nullable=True))
    add_column("download_tasks", sa.Column("part_numbers", sa.JSON(), nullable=True))
    add_column("scan_jobs", sa.Column("scan_paths", sa.JSON(), nullable=False, server_default="[]"))
    add_column("scan_jobs", sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default="0"))
    for name in ("scanned_dirs", "total_roots", "completed_roots"):
        add_column("scan_jobs", sa.Column(name, sa.Integer(), nullable=False, server_default="0"))

    # 从已有真实文件名回填，无需再次请求网盘；历史下载缺少文件树，保留未知分集以免错误放行。
    rows = connection.execute(
        sa.text("SELECT id, code, variant, storage_path, file_name FROM code_records WHERE code LIKE 'FC2-PPV-%'")
    ).mappings()
    for row in rows:
        path = row["storage_path"] + "/" + row["file_name"]
        connection.execute(
            sa.text("UPDATE code_records SET part_number=:part, variant=:variant WHERE id=:id"),
            {
                "id": row["id"],
                "part": extract_part_number(path, row["code"]),
                "variant": extract_variant(path, row["code"]) if row["variant"] == "original" else row["variant"],
            },
        )


def downgrade() -> None:
    for name in ("completed_roots", "total_roots", "scanned_dirs", "cancel_requested", "scan_paths"):
        op.drop_column("scan_jobs", name)
    op.drop_column("download_tasks", "part_numbers")
    op.drop_column("code_records", "part_number")
    op.drop_column("storage_group_paths", "priority")
