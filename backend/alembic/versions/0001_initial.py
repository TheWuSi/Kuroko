"""initial schema"""

import sqlalchemy as sa

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(64), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("username"),
    )
    op.create_table(
        "system_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("key"),
    )
    op.create_table(
        "storage_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "storage_group_paths",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("storage_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("storage_mount", sa.String(255), nullable=False),
        sa.Column("folder_path", sa.String(1024), nullable=False),
        sa.UniqueConstraint("group_id", "storage_mount", "folder_path"),
    )
    op.create_table(
        "storage_space_overrides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("storage_mount", sa.String(255), nullable=False),
        sa.Column("total_space_bytes", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("storage_mount"),
    )
    op.create_table(
        "download_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("magnet", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("speed", sa.String(64)),
        sa.Column("target_path", sa.String(1024), nullable=False),
        sa.Column("openlist_task_id", sa.String(255)),
        sa.Column("total_size", sa.Integer(), nullable=False),
        sa.Column("downloaded_size", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("task_id"),
    )
    op.create_table(
        "code_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=False),
        sa.Column("file_name", sa.String(1024), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("discovered_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("source", sa.String(32), nullable=False),
        sa.UniqueConstraint("code", "storage_path", "file_name"),
    )
    op.create_table(
        "scan_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("group_id", sa.Integer()),
        sa.Column("scanned_files", sa.Integer(), nullable=False),
        sa.Column("new_codes_found", sa.Integer(), nullable=False),
        sa.Column("current_path", sa.String(1024)),
        sa.Column("progress_percent", sa.Float(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.Text()),
        sa.UniqueConstraint("task_id"),
    )


def downgrade() -> None:
    for table in (
        "scan_jobs",
        "code_records",
        "download_tasks",
        "storage_space_overrides",
        "storage_group_paths",
        "storage_groups",
        "system_configs",
        "users",
    ):
        op.drop_table(table)
