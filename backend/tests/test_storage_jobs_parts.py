import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from alembic import command
from app.core.database import get_db
from app.main import app
from app.models.config import ScanJob
from app.models.storage import StorageGroup, StorageSpaceOverride
from app.models.task import DownloadTask
from app.services.code_service import ScanCancelledError, recover_orphaned_scans, run_scan
from app.services.download_service import sync_tasks, sync_transfer_revision
from app.services.openlist_client import OpenListClient
from app.services.storage_service import choose_target
from app.utils.code_extractor import extract_code, extract_media_code, extract_part_number, extract_variant
from app.utils.magnet_parser import magnet_info_hash
from tests.test_api_integration import MAGNET, add_local_task, ok, post_download, remote_task
from tests.test_api_integration import api as api
from tests.test_library_workflow import add_record, duplicates, group, media, scan
from tests.test_library_workflow import library as library
from tests.test_migrations import migration_config


@pytest.fixture
def disk_library(library, tmp_path, monkeypatch):
    path = tmp_path / "concurrent.db"
    connection = library.db.get_bind().raw_connection()
    target = sqlite3.connect(path)
    try:
        connection.driver_connection.backup(target)
    finally:
        target.close()
        connection.close()
    engine = create_engine("sqlite:///" + str(path), connect_args={"check_same_thread": False, "timeout": 1})
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    old_db, overrides = library.db, app.dependency_overrides.copy()

    def database():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr("app.services.code_service.SessionLocal", sessions)
    library.db = sessions()
    try:
        yield library
    finally:
        library.db.close()
        library.db = old_db
        app.dependency_overrides = overrides
        engine.dispose()


def revision(api):
    return api.client.get("/api/v1/storages/revision").json()["data"]


@pytest.mark.parametrize("value", [-1, 10000, 1.5, "2", True])
def test_priority_requires_bounded_integer(library, value):
    response = library.client.post(
        "/api/v1/storage-groups",
        json={
            "name": "invalid",
            "members": [{"storage_id": 73, "download_path": "/drive/Media", "priority": value}],
        },
    )
    assert response.status_code == 422


def test_priority_wins_over_best_fit_and_reservations_trigger_fallback(library):
    primary = group(
        library,
        members=[
            {"storage_id": 73, "download_path": "/drive/Downloads", "priority": 1},
            {"storage_id": 99, "download_path": "/second/Incoming", "priority": 10},
        ],
    )
    library.upstream.storages[1]["mount_details"]["free_space"] = 1000
    first = post_download(library, [{"magnet": MAGNET, "code": "ABC-123", "target_group": primary["id"]}])
    assert first["submitted"][0]["target_path"] == "/second/Incoming"
    second = post_download(
        library,
        [
            {
                "magnet": "magnet:?xt=urn:btih:" + "b" * 40,
                "code": "ABC-124",
                "target_group": primary["id"],
            }
        ],
    )
    assert second["submitted"][0]["target_path"] == "/drive/Downloads"


def test_priority_ties_keep_best_fit_and_unavailable_nodes_are_skipped(library):
    primary = group(library)
    model = library.db.get(StorageGroup, primary["id"])
    infos = [
        {"id": 73, "mount_path": "/drive", "free_space": 900, "status": "work"},
        {"id": 99, "mount_path": "/second", "free_space": 500, "status": "work"},
    ]
    assert choose_target(library.db, model, 400, infos=infos)[0] == "/second/Incoming"
    model.paths[0].priority = 10
    assert choose_target(library.db, model, 400, infos=infos)[0] == "/drive/Downloads"
    for patch in ({"free_space": None}, {"free_space": 399}, {"status": "disabled"}, {"ignored": True}):
        changed = [{**infos[0], **patch}, infos[1]]
        assert choose_target(library.db, model, 400, infos=changed)[0] == "/second/Incoming"


def test_legacy_updates_keep_priority_and_revision_reads_do_not_query_upstream(library):
    primary = group(library, members=[{"storage_id": 73, "download_path": "/drive/Media", "priority": 12}])
    before = revision(library)
    requests = len(library.upstream.requests)
    assert revision(library) == before
    assert len(library.upstream.requests) == requests
    for payload in (
        {"members": [{"storage_id": 73, "download_path": "/drive/Next"}]},
        {"storage_paths": ["/drive/Legacy"]},
        {"name": "改名"},
    ):
        response = library.client.put("/api/v1/storage-groups/" + str(primary["id"]), json=payload)
        assert response.status_code == 200
        assert response.json()["data"]["members"][0]["priority"] == 12
    assert revision(library)["revision"] > before["revision"]


def test_manual_quota_reset_restores_native_capacity_and_is_idempotent(library):
    library.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 500})
    before = revision(library)
    for _ in range(2):
        response = library.client.delete("/api/v1/storages/73/space")
        assert response.status_code == 200
        node = response.json()["data"]
        assert (node["total_space"], node["free_space"], node["space_source"]) == (1000, 900, "openlist")
    assert library.db.query(StorageSpaceOverride).count() == 0
    assert revision(library)["revision"] > before["revision"]
    assert library.client.delete("/api/v1/storages/999/space").status_code == 404


def test_reset_remains_automatic_when_native_capacity_is_unavailable(library):
    library.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 500})
    library.upstream.storages[0]["mount_details"] = {}
    library.upstream.overrides[("POST", "/api/fs/get")] = ok(code=403)
    response = library.client.delete("/api/v1/storages/73/space")
    node = response.json()["data"]
    assert response.status_code == 200 and node["space_source"] == "openlist"
    assert node["free_space"] is None and node["space_error"]
    assert library.db.query(StorageSpaceOverride).count() == 0
    assert not any(request.url.path == "/api/fs/list" for request in library.upstream.requests)


def test_reset_reports_success_even_if_refresh_fails_after_deleting_override(library):
    library.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 500})
    calls = []

    def storages(_):
        calls.append(True)
        return (
            ok({"content": library.upstream.storages, "total": len(library.upstream.storages)})
            if len(calls) == 1
            else httpx.Response(502)
        )

    library.upstream.overrides[("GET", "/api/admin/storage/list")] = storages
    response = library.client.delete("/api/v1/storages/73/space")
    assert response.status_code == 200
    assert response.json()["data"]["space_source"] == "openlist"
    assert response.json()["data"]["free_space"] is None
    assert library.db.query(StorageSpaceOverride).count() == 0


def test_finished_downloads_and_transfers_invalidate_once_and_connection_changes_scope(library):
    task = add_local_task(library)
    before = revision(library)
    library.upstream.tasks[task.openlist_task_id]["state"] = 2
    sync_tasks(library.db)
    changed = revision(library)
    assert changed["revision"] > before["revision"]
    sync_tasks(library.db)
    assert revision(library) == changed
    library.upstream.transfers["transfer"] = remote_task("transfer", state=2)
    sync_transfer_revision(library.db)
    transferred = revision(library)
    assert transferred["revision"] > changed["revision"]
    sync_transfer_revision(library.db)
    assert revision(library) == transferred
    library.client.put("/api/v1/config", json={"openlist": {"token": "a-different-test-token"}})
    assert revision(library)["source_id"] != transferred["source_id"]


@pytest.mark.parametrize(
    ("name", "part", "variant"),
    [
        ("FC2-2306901.mp4", 0, "original"),
        ("FC2-2306901(1).mp4", 1, "original"),
        ("FC2-PPV-2306901-2-C.mkv", 2, "C"),
        ("FC2-2306901-UC-CD02.mkv", 2, "UC"),
        ("FC2-2306901-part3-U.mp4", 3, "U"),
        ("FC2-2306901-C(1).mp4", 1, "C"),
        ("/FC2-2306901-C/CD001.mp4", 1, "C"),
        ("/FC2-2306901/CD001-UC.mp4", 1, "UC"),
        ("/FC2-2306901/1.mp4", 1, "original"),
        ("/FC2-2306901/video(2).mp4", 2, "original"),
        ("/ordinary(2)/FC2-2306901/video.mp4", 0, "original"),
        ("FC2-2306901-1080p.mp4", 0, "original"),
    ],
)
def test_fc2_part_names_and_version_suffixes(name, part, variant):
    code = extract_media_code(name)
    assert code == "FC2-PPV-2306901"
    assert extract_part_number(name, code) == part
    assert extract_variant(name, code) == variant
    assert extract_part_number("ABC-123(1).mp4", "ABC-123") is None


def test_distinct_parts_are_not_duplicates_but_same_part_on_another_disk_is(library):
    primary = group(library)
    library.tree["/drive/Downloads"] = [media("FC2-2306901.mp4"), media("FC2-2306901(1).mp4")]
    library.tree["/second/Library"] = [media("FC2-PPV-2306901-CD2.mkv")]
    assert scan(library, primary["id"])["duplicates_found"] == 0
    data = library.client.get("/api/v1/codes", params={"group_id": primary["id"], "page_size": 1}).json()["data"]
    assert data["total"] == 3 and data["total_codes"] == 1 and len(data["items"]) == 1
    library.tree["/second/Library"].append(media("FC2-PPV-2306901-part1.mp4"))
    assert scan(library, primary["id"])["duplicates_found"] == 1
    duplicate = duplicates(library, primary["id"])["items"][0]
    assert duplicate["reason"] == "same_version" and not duplicate["can_ignore"]
    assert {match["kind"] for file in duplicate["files"] for match in file["directory_matches"]} == {
        "download",
        "archive",
    }


def test_version_allowances_allow_multiple_distinct_parts_but_never_a_copy(library):
    primary = group(library)
    for path, variant in (("/drive/Downloads", "C"), ("/second/Library", "UC")):
        library.tree[path] = [media("FC2-2306901-" + variant + "-CD" + str(part) + ".mp4") for part in (1, 2)]
    assert scan(library, primary["id"])["duplicates_found"] == 1
    assert duplicates(library, primary["id"])["items"][0]["can_ignore"]
    library.client.put(
        "/api/v1/codes/duplicate-ignores",
        json={
            "group_id": primary["id"],
            "code": "FC2-2306901",
            "variants": ["C", "UC"],
        },
    )
    assert duplicates(library, primary["id"])["total"] == 0
    library.tree["/drive/Archive"] = [media("FC2-PPV-2306901-CD1-C.mp4")]
    assert scan(library, primary["id"])["duplicates_found"] == 1
    assert not duplicates(library, primary["id"])["items"][0]["can_ignore"]


def test_directory_labels_use_longest_match_and_keep_both_roles_for_identical_roots(library):
    primary = group(
        library,
        members=[
            {
                "storage_id": 73,
                "download_path": "/drive/Media",
                "archive_paths": ["/drive/Media", "/drive/Media/Archive"],
            }
        ],
    )
    add_record(library, "/drive/Media", "ABC-123-C.mp4")
    add_record(library, "/drive/Media/Archive", "ABC-123-UC.mp4")
    files = duplicates(library, primary["id"])["items"][0]["files"]
    assert {match["kind"] for match in files[0]["directory_matches"]} == {"download", "archive"}
    assert files[1]["directory_matches"] == [
        {
            "kind": "archive",
            "path": "/drive/Media/Archive",
            "storage_id": 73,
            "storage_mount": "/drive",
        }
    ]


def test_parse_precheck_and_submission_share_full_part_set_including_active_tasks(library):
    primary = group(library)
    add_record(library, "/drive/Archive", "FC2-2306901.mp4")
    magnet = "magnet:?xt=urn:btih:" + "a" * 40 + "&dn=FC2-2306901"

    def metadata(request):
        value = json.loads(request.content)["magnet_uri"]
        return httpx.Response(
            200,
            json={
                "info_hash": magnet_info_hash(value),
                "name": "FC2-2306901",
                "size": 600,
                "files": [
                    {"path": "CD001.mp4", "size": 300, "offset": 0},
                    {"path": "CD002.mp4", "size": 300, "offset": 300},
                ],
            },
        )

    library.upstream.overrides[("POST", "/api/v1/metadata")] = metadata
    parsed = library.client.post(
        "/api/v1/magnets/parse",
        json={
            "magnet_links": [magnet],
            "target_group": primary["id"],
        },
    ).json()["data"]["results"][0]
    assert parsed["verified_code"] == "FC2-PPV-2306901"
    assert parsed["part_numbers"] == [1, 2] and parsed["duplicate_allowed"]
    check = {"items": [{"code": "FC2-2306901", "part_numbers": [1, 2]}], "target_group": primary["id"]}
    assert library.client.post("/api/v1/magnets/check-duplicates", json=check).json()["data"]["items"][0][
        "duplicate_allowed"
    ]
    task = {"magnet": magnet, "code": "FC2-2306901", "target_path": "/drive/Downloads"}
    assert len(post_download(library, [task])["submitted"]) == 1
    assert library.db.query(DownloadTask).one().part_numbers == [1, 2]
    check["items"][0]["part_numbers"] = [2]
    assert library.client.post("/api/v1/magnets/check-duplicates", json=check).json()["data"]["items"][0][
        "duplicate_blocked"
    ]
    repeated = {**task, "magnet": magnet.replace("a" * 40, "b" * 40), "part_numbers": [999]}
    assert post_download(library, [repeated])["skipped"][0]["reason"] == "already_exists"
    library.upstream.overrides[("POST", "/api/v1/metadata")] = httpx.Response(504)
    assert post_download(library, [{**task, "magnet": magnet.replace("a" * 40, "c" * 40)}])["skipped"]


@pytest.mark.parametrize("parts", [[-1], [10000], [True], [1.5], [], [1] * 1001])
def test_precheck_rejects_invalid_part_sets(library, parts):
    response = library.client.post(
        "/api/v1/magnets/check-duplicates",
        json={
            "items": [{"code": "FC2-2306901", "part_numbers": parts}],
        },
    )
    assert response.status_code == 422


def queued_scan(library, monkeypatch, group_id):
    monkeypatch.setattr("app.api.v1.codes.run_scan", lambda _: None)
    response = library.client.post("/api/v1/codes/scan", json={"group_id": group_id})
    assert response.status_code == 200
    return response.json()["data"]["task_id"]


def test_long_scan_can_exceed_five_minutes_and_keeps_progress(library, monkeypatch):
    primary = group(library)
    clock = [0]
    monkeypatch.setattr("app.services.code_service.time", SimpleNamespace(monotonic=lambda: clock[0]))
    original = library.upstream.overrides[("POST", "/api/fs/list")]

    def slow(request):
        clock[0] += 301
        return original(request)

    library.upstream.overrides[("POST", "/api/fs/list")] = slow
    library.tree["/drive/Downloads"] = [media("ABC-123.mp4")]
    result = scan(library, primary["id"])
    assert clock[0] > 300 and result["status"] == "completed"
    assert result["scanned_dirs"] == result["total_roots"] == result["completed_roots"] == 4
    assert result["started_at"].endswith("+00:00")


def test_pending_cancel_does_not_read_upstream_and_restart_marks_interruption(library, monkeypatch):
    primary = group(library)
    task_id = queued_scan(library, monkeypatch, primary["id"])
    before = len(library.upstream.requests)
    assert library.client.post("/api/v1/codes/scan/" + task_id + "/cancel").status_code == 200
    run_scan(task_id)
    assert len(library.upstream.requests) == before
    assert library.client.get("/api/v1/codes/scan/status").json()["data"]["status"] == "cancelled"
    assert library.client.post("/api/v1/codes/scan/" + task_id + "/cancel").status_code == 200
    next_id = queued_scan(library, monkeypatch, primary["id"])
    assert recover_orphaned_scans(library.db) == 1
    library.db.expire_all()
    assert library.db.query(ScanJob).filter_by(task_id=next_id).one().status == "failed"
    assert library.client.post("/api/v1/codes/scan/" + next_id + "/cancel").status_code == 409


def test_scan_freezes_scope_before_group_edits(library, monkeypatch):
    primary = group(library, members=[{"storage_id": 73, "download_path": "/drive/Old"}])
    library.tree["/drive/Old"] = [media("ABC-123.mp4")]
    library.tree["/drive/New"] = [media("ABC-124.mp4")]
    task_id = queued_scan(library, monkeypatch, primary["id"])
    library.client.put(
        "/api/v1/storage-groups/" + str(primary["id"]),
        json={
            "members": [{"storage_id": 73, "download_path": "/drive/New"}],
        },
    )
    run_scan(task_id)
    result = library.client.get("/api/v1/codes/scan/status").json()["data"]
    assert result["status"] == "completed" and result["scan_paths"] == ["/drive/Old"]
    data = library.client.get("/api/v1/codes").json()["data"]
    assert data["total"] == 1 and data["items"][0]["code"] == "ABC-123"


def test_cancel_and_progress_stay_responsive_during_network_wait_and_keep_old_index(disk_library, monkeypatch):
    library = disk_library
    primary = group(library, members=[{"storage_id": 73, "download_path": "/drive/Media"}])
    add_record(library, "/drive/Media", "OLD-123.mp4")
    library.tree["/drive/Media"] = [media("NEW-123.mp4"), {"name": "slow", "size": 0, "is_dir": True}]
    task_id = queued_scan(library, monkeypatch, primary["id"])
    entered, release = threading.Event(), threading.Event()
    original = library.upstream.overrides[("POST", "/api/fs/list")]

    def slow(request):
        if json.loads(request.content)["path"].endswith("/slow"):
            entered.set()
            assert release.wait(5)
        return original(request)

    library.upstream.overrides[("POST", "/api/fs/list")] = slow
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(run_scan, task_id)
        try:
            assert entered.wait(5)
            status = library.client.get("/api/v1/codes/scan/status").json()["data"]
            assert status["scanned_files"] == 1 and status["scanned_dirs"] == 2
            assert library.client.post("/api/v1/codes/scan", json={}).status_code == 409
            assert library.client.post("/api/v1/codes/scan/" + task_id + "/cancel").status_code == 200
        finally:
            release.set()
        future.result(timeout=5)
    result = library.client.get("/api/v1/codes/scan/status").json()["data"]
    assert result["status"] == "cancelled" and result["completed_roots"] == 0
    assert {item["code"] for item in library.client.get("/api/v1/codes").json()["data"]["items"]} == {
        "OLD-123",
        "NEW-123",
    }


def test_cancel_stops_before_next_directory_page_without_returning_partial_files():
    pages = []

    def handle(request):
        payload = json.loads(request.content)
        page, per_page = payload["page"], payload["per_page"]
        pages.append(page)
        return ok(
            {
                "total": 201,
                "content": [
                    media("ABC-" + str(index) + ".mp4")
                    for index in range((page - 1) * per_page, min(page * per_page, 201))
                ],
            }
        )

    checks = []

    def check():
        checks.append(True)
        if len(checks) == 2:
            raise ScanCancelledError()

    with OpenListClient(
        {"base_url": "https://openlist.test", "token": "test-token"}, transport=httpx.MockTransport(handle)
    ) as client:
        with pytest.raises(ScanCancelledError):
            client.list_files("/drive/Media", refresh=True, before_page=check)
        assert pages == [1]
        assert len(client.list_files("/drive/Media", refresh=True)) == 201


def test_migration_backfills_existing_parts_without_losing_records(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "parts.db"))
    with engine.begin() as connection:
        config = migration_config(connection)
        command.upgrade(config, "0002_library_scopes")
        for name in ("FC2-2306901.mp4", "FC2-2306901(1).mp4", "FC2-2306901-CD2-C.mp4"):
            connection.execute(
                text(
                    "INSERT INTO code_records (code, variant, storage_path, file_name, file_size, source) "
                    "VALUES (:code, 'original', '/drive/Media', :name, 100, 'scan')"
                ),
                {"code": extract_code(name), "name": name},
            )
        command.upgrade(config, "head")
        rows = connection.execute(text("SELECT part_number, variant FROM code_records ORDER BY id")).all()
        assert rows == [(0, "original"), (1, "original"), (2, "C")]
        command.upgrade(config, "head")
        assert connection.execute(text("SELECT count(*) FROM code_records")).scalar_one() == 3
    engine.dispose()
