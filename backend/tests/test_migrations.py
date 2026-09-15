import json
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core import database
from app.models.code import DuplicateAllowance
from app.models.storage import StorageIgnore


def migration_config(connection):
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    config.attributes["connection"] = connection
    return config


def test_fresh_database_is_migrated_and_startup_is_idempotent(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "fresh.db"))
    monkeypatch.setattr(database, "engine", engine)
    database.init_db()
    database.init_db()
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == "0005_magnet_manual_code"
        )
        assert {"storage_ignores", "duplicate_allowances"}.issubset(inspect(connection).get_table_names())
        assert "archive_folders" in {
            column["name"] for column in inspect(connection).get_columns("storage_group_paths")
        }
        assert "ix_code_records_code" in {index["name"] for index in inspect(connection).get_indexes("code_records")}
        assert {"manual_code", "next_attempt_at"}.issubset(
            {column["name"] for column in inspect(connection).get_columns("magnet_parse_items")}
        )
    engine.dispose()


@pytest.mark.parametrize("empty_version_table", [False, True])
@pytest.mark.parametrize("schema_state", ["legacy", "mixed_tables", "partial_columns", "current"])
def test_unversioned_database_keeps_data_and_migrates_probe_paths_and_fc2_aliases(
    tmp_path,
    monkeypatch,
    empty_version_table,
    schema_state,
):
    engine = create_engine("sqlite:///" + str(tmp_path / "legacy.db"))
    with engine.begin() as connection:
        command.upgrade(migration_config(connection), "0001_initial")
        connection.execute(text("INSERT INTO storage_groups (id, name) VALUES (1, '旧媒体库')"))
        connection.execute(
            text(
                "INSERT INTO storage_group_paths (group_id, storage_mount, folder_path) "
                "VALUES (1, '/drive', '/Downloads')"
            )
        )
        probes = [{"group_name": "旧媒体库", "paths": [{"storage_mount": "/drive", "folder": "/Archive"}]}]
        connection.execute(
            text("INSERT INTO system_configs (key, value) VALUES ('probe_paths', :value)"),
            {"value": json.dumps(probes)},
        )
        for code in ("FC2-654321", "FC2-PPV-654321"):
            connection.execute(
                text(
                    "INSERT INTO code_records (code, storage_path, file_name, file_size, source) "
                    "VALUES (:code, '/drive/Archive', 'FC2-654321-UC.mp4', 100, 'scan')"
                ),
                {"code": code},
            )
        connection.execute(
            text(
                "INSERT INTO download_tasks "
                "(task_id, code, magnet, status, progress, target_path, total_size, downloaded_size) "
                "VALUES ('legacy-task', 'FC2-654321', :magnet, 'completed', 100, '/drive/Downloads', 100, 100)"
            ),
            {"magnet": "magnet:?xt=urn%3Abtih%3A" + "a" * 40 + "&dn=FC2-654321-C"},
        )
        if schema_state == "mixed_tables":
            StorageIgnore.__table__.create(connection)
            DuplicateAllowance.__table__.create(connection)
        elif schema_state == "partial_columns":
            connection.execute(text("ALTER TABLE storage_group_paths ADD COLUMN storage_id INTEGER"))
        elif schema_state == "current":
            command.upgrade(migration_config(connection), "head")
            connection.execute(text("INSERT INTO storage_ignores (storage_id, storage_mount) VALUES (73, '/drive')"))
            connection.execute(
                text(
                    "INSERT INTO duplicate_allowances (group_id, code, variants) "
                    "VALUES (1, 'FC2-PPV-654321', :variants)"
                ),
                {"variants": '["C", "UC"]'},
            )
        # 覆盖无版本表、空版本表，以及 create_all 遗留的新旧混合结构。
        connection.execute(text("DELETE FROM alembic_version" if empty_version_table else "DROP TABLE alembic_version"))
    monkeypatch.setattr(database, "engine", engine)
    database.init_db()
    database.init_db()
    with engine.connect() as connection:
        records = connection.execute(text("SELECT code, variant, file_name FROM code_records")).all()
        assert records == [("FC2-PPV-654321", "UC", "FC2-654321-UC.mp4")]
        member = connection.execute(
            text("SELECT folder_path, archive_folders, storage_id FROM storage_group_paths")
        ).one()
        assert member[0] == "/Downloads" and json.loads(member[1]) == ["/Archive"] and member[2] is None
        task = connection.execute(text("SELECT code, variant, magnet FROM download_tasks")).one()
        assert task[0:2] == ("FC2-PPV-654321", "C")
        assert task[2] == "magnet:?xt=urn:btih:" + "a" * 40 + "&dn=FC2-654321-C"
        assert (
            json.loads(
                connection.execute(text("SELECT value FROM system_configs WHERE key='probe_paths'")).scalar_one()
            )
            == []
        )
        if schema_state == "current":
            assert connection.execute(text("SELECT count(*) FROM storage_ignores")).scalar_one() == 1
            assert connection.execute(text("SELECT count(*) FROM duplicate_allowances")).scalar_one() == 1
    engine.dispose()


def test_failed_startup_migration_rolls_back_schema_changes(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "failed.db"))
    monkeypatch.setattr(database, "engine", engine)

    def fail_after_ddl(config, revision):
        config.attributes["connection"].execute(text("CREATE TABLE incomplete_migration (id INTEGER PRIMARY KEY)"))
        raise RuntimeError("模拟升级中断")

    monkeypatch.setattr(database.command, "upgrade", fail_after_ddl)
    with pytest.raises(RuntimeError, match="模拟升级中断"):
        database.init_db()
    assert "incomplete_migration" not in inspect(engine).get_table_names()
    engine.dispose()
