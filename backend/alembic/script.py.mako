"""${message}"""
from alembic import op
import sqlalchemy as sa

revision = '${up_revision}'
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}

def upgrade() -> None:
    ${upgrades or 'pass'}

def downgrade() -> None:
    ${downgrades or 'pass'}
