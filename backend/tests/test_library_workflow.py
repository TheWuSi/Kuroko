import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.code import CodeRecord, DuplicateAllowance
from app.models.config import ScanJob
from app.models.task import DownloadTask
from app.utils.code_extractor import extract_code, extract_variant
from tests.test_api_integration import MAGNET, ok, post_download
from tests.test_api_integration import api as api


@pytest.fixture
def library(api, monkeypatch):
    sessions = sessionmaker(bind=api.db.get_bind(), autoflush=False, expire_on_commit=False)
    monkeypatch.setattr("app.services.code_service.SessionLocal", sessions)
    api.upstream.storages.extend(
        [
            {
                "id": 99,
                "mount_path": "/second",
                "driver": "GoogleDrive",
                "status": "work",
                "mount_details": {"free_space": 10000},
            },
            {
                "id": 120,
                "mount_path": "/loose",
                "driver": "GoogleDrive",
                "status": "work",
                "mount_details": {"free_space": 10000},
            },
        ]
    )
    api.tree = {}

    def directories(request):
        path = json.loads(request.content)["path"]
        content = api.tree.get(path, [])
        return ok({"content": content, "total": len(content)})

    api.upstream.overrides[("POST", "/api/fs/list")] = directories
    return api


def media(name):
    return {"name": name, "size": 500, "is_dir": False}


def group(api, name="主媒体库", members=None):
    response = api.client.post(
        "/api/v1/storage-groups",
        json={
            "name": name,
            "members": members
            or [
                {"storage_id": 73, "download_path": "/drive/Downloads", "archive_paths": ["/drive/Archive"]},
                {"storage_id": 99, "download_path": "/second/Incoming", "archive_paths": ["/second/Library"]},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def scan(api, group_id=None):
    response = api.client.post("/api/v1/codes/scan", json={"group_id": group_id})
    assert response.status_code == 200, response.text
    return api.client.get("/api/v1/codes/scan/status", params={"task_id": response.json()["data"]["task_id"]}).json()[
        "data"
    ]


def duplicates(api, group_id):
    return api.client.get("/api/v1/codes/duplicates", params={"group_id": group_id}).json()["data"]


def add_record(api, path, name):
    code = extract_code(name)
    row = CodeRecord(code=code, variant=extract_variant(name, code), storage_path=path, file_name=name, file_size=500)
    api.db.add(row)
    api.db.commit()
    return row


def test_members_select_real_storages_and_one_storage_can_belong_to_multiple_groups(library):
    first = group(library)
    second = group(library, "独立媒体库", [{"storage_id": 73, "download_path": "/drive/Other", "archive_paths": []}])
    assert first["members"][0]["storage_id"] == second["members"][0]["storage_id"] == 73
    assert first["members"][0]["archive_paths"] == ["/drive/Archive"]
    update = library.client.put(
        f"/api/v1/storage-groups/{first['id']}",
        json={
            "members": [
                {"storage_id": 73, "download_path": "/drive/Downloads", "archive_paths": ["/drive/NewArchive"]},
            ]
        },
    )
    assert update.status_code == 200
    assert update.json()["data"]["members"][0]["archive_paths"] == ["/drive/NewArchive"]
    assert library.client.get("/api/v1/codes/scan/paths", params={"group_id": first["id"]}).json()["data"]["paths"] == [
        "/drive/Downloads",
        "/drive/NewArchive",
    ]


@pytest.mark.parametrize(
    "member",
    [
        {"storage_id": 73, "download_path": "/second/Incoming"},
        {"storage_id": 73, "download_path": "/drive"},
        {"storage_id": 73, "download_path": "/drive/Downloads", "archive_paths": ["/second/Library"]},
        {"storage_id": 73, "download_path": "/drive/../escape"},
        {"storage_id": 73, "download_path": "/drive/Downloads", "archive_paths": ["/drive"]},
    ],
)
def test_member_directories_stay_inside_selected_mount(library, member):
    response = library.client.post("/api/v1/storage-groups", json={"name": "invalid", "members": [member]})
    assert response.status_code in {400, 422}


def test_directory_browser_lists_only_directories_and_prevents_cross_mount_access(library):
    library.tree["/drive"] = [{"name": "中文目录", "size": 0, "is_dir": True}, media("ABC-123.mp4")]
    data = library.client.get("/api/v1/storages/73/directories").json()["data"]
    assert data["directories"] == [{"name": "中文目录", "path": "/drive/中文目录"}]
    assert library.client.get("/api/v1/storages/73/directories", params={"path": "/second/Incoming"}).status_code == 400
    assert library.client.get("/api/v1/storages/73/directories", params={"path": "/drive/../escape"}).status_code == 400
    assert library.client.get("/api/v1/storages/404/directories").status_code == 404


def test_scan_indexes_both_directories_and_fc2_aliases_across_disks(library):
    primary = group(library)
    other = group(library, "其他分组", [{"storage_id": 73, "download_path": "/drive/Other", "archive_paths": []}])
    library.tree.update(
        {
            "/drive/Downloads": [media("FC2-654321-C.mp4"), {"name": "ABC-456-U", "size": 0, "is_dir": True}],
            "/drive/Downloads/ABC-456-U": [media("video.mkv")],
            "/drive/Archive": [media("XYZ-777.mp4")],
            "/second/Library": [media("FC2-PPV-654321-UC.mkv")],
            "/drive/Other": [media("FC2-654321-U.mp4")],
        }
    )
    result = scan(library)
    assert result["status"] == "completed", result
    assert result["scanned_files"] == 5 and result["duplicates_found"] == 1
    files = library.client.get("/api/v1/codes", params={"group_id": primary["id"]}).json()["data"]
    assert files["total"] == 4
    assert {file["variant"] for file in files["items"] if file["code"] == "ABC-456"} == {"U"}
    assert library.client.get("/api/v1/codes", params={"group_id": other["id"]}).json()["data"]["total"] == 1
    duplicate = duplicates(library, primary["id"])["items"][0]
    assert duplicate["code"] == "FC2-PPV-654321" and duplicate["variants"] == ["C", "UC"]
    assert duplicate["can_ignore"] is True
    assert library.client.get("/api/v1/codes", params={"search": "fc2-654321"}).json()["data"]["total"] == 3


def test_allowance_survives_moves_but_same_version_copy_still_warns(library):
    primary = group(library)
    library.tree.update({"/drive/Downloads": [media("ABC-123-C.mkv")], "/second/Library": [media("ABC-123-UC.mkv")]})
    assert scan(library, primary["id"])["status"] == "completed"
    response = library.client.put(
        "/api/v1/codes/duplicate-ignores", json={"group_id": primary["id"], "code": "ABC-123", "variants": ["C", "UC"]}
    )
    assert response.status_code == 200
    rule_id = response.json()["data"]["id"]
    assert duplicates(library, primary["id"])["total"] == 0
    library.tree["/drive/Downloads"] = []
    library.tree["/drive/Archive"] = [media("ABC-123-C.mkv")]
    assert scan(library, primary["id"])["status"] == "completed"
    assert duplicates(library, primary["id"])["total"] == 0
    assert library.db.query(CodeRecord).filter_by(storage_path="/drive/Downloads").count() == 0
    library.tree["/second/Incoming"] = [media("ABC-123-C.mp4")]
    assert scan(library, primary["id"])["duplicates_found"] == 1
    duplicate = duplicates(library, primary["id"])["items"][0]
    assert duplicate["reason"] == "same_version" and duplicate["can_ignore"] is False
    assert library.db.query(DuplicateAllowance).one().id == rule_id
    assert library.client.delete(f"/api/v1/codes/duplicate-ignores/{rule_id}").status_code == 200
    assert library.client.get("/api/v1/codes/duplicate-ignores").json()["data"]["items"] == []


def test_ignored_storage_is_hidden_excluded_from_scan_and_never_receives_downloads(library):
    primary = group(library)
    add_record(library, "/drive/Archive", "ABC-123-C.mp4")
    library.tree["/second/Library"] = [media("ABC-124.mp4")]
    assert library.client.put("/api/v1/storages/73/ignore", json={"ignored": True}).status_code == 200
    visible = library.client.get("/api/v1/storages").json()["data"]["storages"]
    assert {node["id"] for node in visible} == {99, 120}
    hidden = library.client.get("/api/v1/storages", params={"include_ignored": True}).json()["data"]["storages"]
    assert next(node for node in hidden if node["id"] == 73)["free_space"] is None
    assert library.client.get("/api/v1/storages/73/directories").status_code == 400
    response = post_download(
        library, [{"magnet": MAGNET, "code": "ABC-123", "target_path": "/drive/Downloads", "force": True}]
    )
    assert response["failed"] and library.upstream.submissions == []
    assert scan(library, primary["id"])["status"] == "completed"
    requested = [
        json.loads(request.content)["path"]
        for request in library.upstream.requests
        if request.url.path == "/api/fs/list"
    ]
    assert all(not path.startswith("/drive") for path in requested)
    assert library.db.query(CodeRecord).filter_by(storage_path="/drive/Archive").count() == 1
    assert library.client.get("/api/v1/codes").json()["data"]["total"] == 1
    assert library.client.put("/api/v1/storages/73/ignore", json={"ignored": False}).status_code == 200
    assert library.client.get("/api/v1/codes").json()["data"]["total"] == 2


def test_automatic_scheduling_skips_ignored_member_and_uses_its_configured_download_path(library):
    primary = group(library)
    library.client.put("/api/v1/storages/73/ignore", json={"ignored": True})
    result = post_download(library, [{"magnet": MAGNET, "code": "ABC-123", "target_group": primary["id"]}])
    assert result["submitted"][0]["target_path"] == "/second/Incoming"
    assert library.upstream.submissions[0]["urls"] == [MAGNET]


def test_scoped_download_checks_and_persisted_versions_apply_to_submission(library):
    primary = group(library)
    group(library, "另一库", [{"storage_id": 73, "download_path": "/drive/Other", "archive_paths": []}])
    add_record(library, "/drive/Archive", "ABC-123-C.mkv")
    task = {"magnet": MAGNET, "code": "ABC-123", "variant": "UC", "target_path": "/second/Incoming"}
    assert post_download(library, [task])["skipped"][0]["reason"] == "already_exists"
    library.client.put(
        "/api/v1/codes/duplicate-ignores", json={"group_id": primary["id"], "code": "ABC-123", "variants": ["C", "UC"]}
    )
    assert len(post_download(library, [task])["submitted"]) == 1
    repeated = {**task, "magnet": MAGNET.replace("0123456789abcdef0123456789abcdef01234567", "b" * 40)}
    assert post_download(library, [repeated])["skipped"][0]["reason"] == "already_exists"
    assert len(post_download(library, [{**task, "target_path": "/drive/Other"}])["submitted"]) == 1
    assert len(post_download(library, [{**task, "target_path": "/loose/Video"}])["submitted"]) == 1


def test_precheck_scope_can_change_without_requesting_metadata(library):
    primary = group(library)
    add_record(library, "/second/Library", "FC2-PPV-654321-C.mp4")
    before = len(library.upstream.requests)
    payload = {"items": [{"code": "FC2-654321", "variant": "UC"}], "target_group": primary["id"]}
    checked = library.client.post("/api/v1/magnets/check-duplicates", json=payload).json()["data"]["items"][0]
    assert checked["duplicate_blocked"] is True
    assert checked["scope_group_ids"] == [primary["id"]]
    checked = library.client.post(
        "/api/v1/magnets/check-duplicates", json={**payload, "target_group": None, "target_path": "/loose/Video"}
    ).json()["data"]["items"][0]
    assert checked["duplicate_blocked"] is False and checked["dedup_scope"] == "directory"
    assert len(library.upstream.requests) == before


def test_scan_failure_does_not_remove_old_index_for_incomplete_directory(library):
    primary = group(library)
    add_record(library, "/drive/Downloads", "OLD-123.mp4")
    library.tree["/drive/Downloads"] = [media("NEW-123.mp4"), {"name": "denied", "size": 0, "is_dir": True}]
    original = library.upstream.overrides[("POST", "/api/fs/list")]
    library.upstream.overrides[("POST", "/api/fs/list")] = lambda request: (
        ok(code=403) if json.loads(request.content)["path"].endswith("/denied") else original(request)
    )
    result = scan(library, primary["id"])
    assert result["status"] == "failed"
    assert library.db.query(CodeRecord).filter_by(code="OLD-123").count() == 1


def test_scan_deduplicates_overlapping_roots_and_never_crosses_independent_mount(library):
    primary = group(
        library,
        members=[
            {"storage_id": 73, "download_path": "/drive/Media", "archive_paths": ["/drive/Media/Archive"]},
        ],
    )
    library.upstream.storages.append({"id": 200, "mount_path": "/drive/Media/Nested", "status": "work"})
    library.tree["/drive/Media"] = [
        {"name": "Archive", "is_dir": True, "size": 0},
        {"name": "Nested", "is_dir": True, "size": 0},
    ]
    library.tree["/drive/Media/Archive"] = [media("ABC-123.mp4")]
    library.tree["/drive/Media/Nested"] = [media("SHOULD-123.mp4")]
    result = scan(library, primary["id"])
    assert result["status"] == "completed" and result["scanned_files"] == 1
    paths = [
        json.loads(request.content)["path"]
        for request in library.upstream.requests
        if request.url.path == "/api/fs/list"
    ]
    assert paths.count("/drive/Media/Archive") == 1
    assert "/drive/Media/Nested" not in paths


def test_scans_reject_empty_configuration_and_unknown_group(library):
    assert library.client.post("/api/v1/codes/scan", json={}).status_code == 400
    assert library.client.post("/api/v1/codes/scan", json={"group_id": 987}).status_code == 404
    assert library.db.query(ScanJob).count() == 0


def test_concurrent_submissions_do_not_duplicate_group_code(library):
    group(library)
    tasks = [
        {"magnet": MAGNET, "code": "ABC-123", "target_path": "/drive/Downloads"},
        {"magnet": MAGNET, "code": "ABC-123", "target_path": "/second/Incoming"},
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda task: post_download(library, [task]), tasks))
    assert sum(len(item["submitted"]) for item in outcomes) == 1
    assert sum(len(item["skipped"]) for item in outcomes) == 1
    assert library.db.query(DownloadTask).count() == 1


@pytest.mark.parametrize("variants", [["C", "C"], ["C"], ["C", "BAD"]])
def test_invalid_version_allowances_are_rejected(library, variants):
    primary = group(library)
    response = library.client.put(
        "/api/v1/codes/duplicate-ignores", json={"group_id": primary["id"], "code": "ABC-123", "variants": variants}
    )
    assert response.status_code == 422


def test_legacy_group_update_keeps_archive_directories(library):
    primary = group(library)
    response = library.client.put(
        f"/api/v1/storage-groups/{primary['id']}",
        json={"storage_paths": ["/drive/NewDownloads", "/second/Incoming"]},
    )
    assert response.status_code == 200
    members = response.json()["data"]["members"]
    assert members[0]["download_path"] == "/drive/NewDownloads"
    assert members[0]["archive_paths"] == ["/drive/Archive"]
    assert members[1]["archive_paths"] == ["/second/Library"]
