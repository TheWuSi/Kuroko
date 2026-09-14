"""持久化磁力解析、逐条结果与提交历史。"""

import sqlalchemy as sa

from alembic import op

revision = "0004_magnet_jobs"
down_revision = "0003_storage_jobs_parts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 兼容旧版启动流程提前 create_all 的数据库，DDL 仍由启动事务整体保护。
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "magnet_parse_jobs" not in tables:
        op.create_table(
            "magnet_parse_jobs",
            sa.Column("job_id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("request_id", sa.String(36), nullable=False),
            sa.Column("fingerprint", sa.String(64), nullable=False),
            sa.Column("scope", sa.JSON(), nullable=False),
            sa.Column("filter_config", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("cancel_requested", sa.Boolean(), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("finished_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("user_id", "request_id"),
        )
    if "magnet_parse_items" not in tables:
        op.create_table(
            "magnet_parse_items",
            sa.Column(
                "job_id", sa.String(36), sa.ForeignKey("magnet_parse_jobs.job_id", ondelete="CASCADE"), primary_key=True
            ),
            sa.Column("index", sa.Integer(), primary_key=True),
            sa.Column("magnet", sa.Text(), nullable=False),
            sa.Column("info_hash", sa.String(40), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("attempt", sa.Integer(), nullable=False),
            sa.Column("run_token", sa.String(36)),
            sa.Column("summary", sa.JSON()),
            sa.Column("result", sa.JSON()),
            sa.Column("error_message", sa.Text()),
            sa.Column("started_at", sa.DateTime(timezone=True)),
            sa.Column("finished_at", sa.DateTime(timezone=True)),
        )
    if "magnet_submissions" not in tables:
        op.create_table(
            "magnet_submissions",
            sa.Column("submission_id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("job_id", sa.String(36), sa.ForeignKey("magnet_parse_jobs.job_id"), nullable=False),
            sa.Column("request_id", sa.String(36), nullable=False),
            sa.Column("fingerprint", sa.String(64), nullable=False),
            sa.Column("scope", sa.JSON(), nullable=False),
            sa.Column("target_key", sa.String(1100), nullable=False),
            sa.Column("force", sa.Boolean(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("finished_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("user_id", "request_id"),
        )
    if "magnet_submission_items" not in tables:
        op.create_table(
            "magnet_submission_items",
            sa.Column(
                "submission_id",
                sa.String(36),
                sa.ForeignKey("magnet_submissions.submission_id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("index", sa.Integer(), primary_key=True),
            sa.Column("info_hash", sa.String(40), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("run_token", sa.String(36)),
            sa.Column("download_task_id", sa.String(36), sa.ForeignKey("download_tasks.task_id")),
            sa.Column("result", sa.JSON()),
        )
    for table, name, columns in (
        ("magnet_parse_jobs", "ix_magnet_parse_owner_status", ["user_id", "status"]),
        ("magnet_parse_items", "ix_magnet_parse_items_status", ["status"]),
        ("magnet_submissions", "ix_magnet_submission_owner_created", ["user_id", "created_at"]),
        ("magnet_submissions", "ix_magnet_submissions_job_id", ["job_id"]),
        ("magnet_submissions", "ix_magnet_submissions_status", ["status"]),
        ("magnet_submission_items", "ix_magnet_submission_items_info_hash", ["info_hash"]),
        ("magnet_submission_items", "ix_magnet_submission_items_status", ["status"]),
    ):
        if name not in {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}:
            op.create_index(name, table, columns)


def downgrade() -> None:
    for table in ("magnet_submission_items", "magnet_submissions", "magnet_parse_items", "magnet_parse_jobs"):
        op.drop_table(table)
