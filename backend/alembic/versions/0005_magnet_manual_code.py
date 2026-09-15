"""磁力条目支持手工番号与错峰重试。"""

import sqlalchemy as sa

from alembic import op

revision = "0005_magnet_manual_code"
down_revision = "0004_magnet_jobs"
branch_labels = None
depends_on = None

COLUMNS = (
    ("magnet_parse_items", "manual_code", sa.String(64)),
    ("magnet_parse_items", "next_attempt_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, name, type_ in COLUMNS:
        # magnet_parse_items 由启动流程的迁移创建；缺失表说明库尚未升级到 0004，跳过即可。
        if table not in tables:
            continue
        if name in {column["name"] for column in inspector.get_columns(table)}:
            continue
        op.add_column(table, sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    # SQLite 由方言决定是否真正删除列，失败时保留列比清空数据表更安全。
    for table, name, _ in reversed(COLUMNS):
        if table in tables and name in {column["name"] for column in inspector.get_columns(table)}:
            op.drop_column(table, name)
