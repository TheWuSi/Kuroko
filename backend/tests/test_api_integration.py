"""使用真实适配器、隔离 SQLite 与上游 HTTP 替身验证业务闭环。"""

import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import get_current_user
from app.main import app
from app.models.code import CodeRecord
from app.models.storage import StorageGroup, StorageGroupPath
from app.models.task import DownloadTask
from app.services.config_service import get_config, update_config
from app.services.magnet_metadata_client import MagnetMetadataApiClient
from app.services.openlist_client import OpenListClient
from app.utils.magnet_parser import clean_magnet, magnet_info_hash

HASH = "0123456789abcdef0123456789abcdef01234567"
MAGNET = f"magnet:?xt=urn:btih:{HASH}&dn=ABC-123"


def ok(data=None, code=200):
    return httpx.Response(200, json={"code": code, "message": "success", "data": data})


def remote_task(task_id, state=1):
    return {
        "id": task_id,
        "name": "转存 /drive/Video/ABC-123.mkv",
        "state": state,
        "status": "等待上游处理",
        "progress": 25,
        "total_bytes": 600,
        "error": None,
        "start_time": "2026-09-12T10:00:00Z",
        "end_time": None,
    }


class Upstream:
    def __init__(self):
        self.requests = []
        self.submissions = []
        self.overrides = {}
        self.storages = [
            {
                "id": 73,
                "mount_path": "/drive",
                "driver": "Onedrive",
                "status": "work",
                "mount_details": {"total_space": 1000, "used_space": 100, "free_space": 900},
            }
        ]
        self.tasks = {}
        self.transfers = {}

    def handle(self, request):
        self.requests.append(request)
        path = request.url.path[request.url.path.index("/api/") :]
        key = (request.method, path)
        if key in self.overrides:
            response = self.overrides[key]
            return response(request) if callable(response) else response
        if path == "/api/v1/health":
            return httpx.Response(200, json={"status": "ok", "stats": {"active_torrents": 2, "active_locks": 1}})
        if path == "/api/v1/metadata":
            magnet = json.loads(request.content)["magnet_uri"]
            return httpx.Response(
                200,
                json={
                    "info_hash": magnet_info_hash(magnet),
                    "name": "ABC-123",
                    "size": 600,
                    "files": [
                        {"path": "ABC-123.mkv", "size": 500, "offset": 0},
                        {"path": "readme.txt", "size": 100, "offset": 500},
                    ],
                },
            )
        if path == "/api/me":
            return ok({"id": 1, "role": 2})
        if path == "/api/public/settings":
            return ok({"version": "v4.2.6"})
        if path == "/api/admin/storage/list":
            return ok({"content": self.storages, "total": len(self.storages)})
        if path == "/api/fs/get":
            return ok({"name": "Video", "is_dir": True, "size": 0})
        if path == "/api/fs/list":
            return ok({"content": [], "total": 0})
        if path == "/api/public/offline_download_tools":
            return ok(["PikPak"])
        if path == "/api/fs/add_offline_download":
            body = json.loads(request.content)
            assert body["tool"] == "PikPak" and body["delete_policy"] == "delete_always"
            assert request.headers["authorization"] == "test-openlist-token"
            self.submissions.append(body)
            task = remote_task(f"upstream-{len(self.submissions)}", state=0)
            self.tasks[task["id"]] = task
            return ok({"tasks": [task]})
        if path.startswith("/api/task/"):
            task_map = self.transfers if "/offline_download_transfer/" in path else self.tasks
            action = path.rsplit("/", 1)[-1]
            if action in {"done", "undone"}:
                assert request.method == "GET"
                return ok([item for item in task_map.values() if (item["state"] in {2, 4, 7}) == (action == "done")])
            assert request.method == "POST" and request.content == b""
            task = task_map.get(request.url.params["tid"])
            if task is None:
                return ok(code=404)
            return ok(task if action == "info" else None)
        raise AssertionError(f"出现未约定的上游请求：{request.method} {path}")


@pytest.fixture
def api(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    db = sessions()
    update_config(
        db,
        {
            "openlist": {
                "base_url": "https://openlist.test",
                "token": "test-openlist-token",
                "password": "test-password",
            },
            "bt_parser": {"service_url": "https://metadata.test", "token": "test-proxy-token", "timeout_seconds": 17},
            "filter": {"min_file_size_mb": 0},
        },
    )
    upstream = Upstream()
    transport = httpx.MockTransport(upstream.handle)

    def openlist(config):
        return OpenListClient(config, transport=transport)

    def metadata(*args, **kwargs):
        return MagnetMetadataApiClient(*args, **kwargs, transport=transport)

    monkeypatch.setattr("app.services.storage_service.OpenListClient", openlist)
    monkeypatch.setattr("app.api.v1.config.OpenListClient", openlist)
    for module in ("app.services.magnet_service", "app.services.download_service", "app.api.v1.config"):
        monkeypatch.setattr(f"{module}.MagnetMetadataApiClient", metadata)

    def database():
        with sessions() as session:
            yield session

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, role="admin")
    # 不进入真实应用 lifespan，避免启动轮询或接触实际数据库。
    client = TestClient(app)
    try:
        yield SimpleNamespace(client=client, db=db, upstream=upstream)
    finally:
        client.close()
        app.dependency_overrides = previous
        db.close()
        engine.dispose()


def post_download(api, tasks):
    response = api.client.post("/api/v1/magnets/batch-download", json={"tasks": tasks})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def add_local_task(api, upstream_id="task-1", status="downloading"):
    task = DownloadTask(
        code="ABC-123",
        magnet=clean_magnet(MAGNET),
        target_path="/drive/Video",
        openlist_task_id=upstream_id,
        status=status,
        total_size=600,
    )
    api.db.add(task)
    api.db.commit()
    api.upstream.tasks[upstream_id] = remote_task(upstream_id)
    return task


def test_config_partial_update_and_masked_secrets(api):
    current = api.client.get("/api/v1/config").json()["data"]
    assert current["openlist"]["password"] == current["openlist"]["token"] == "****"
    response = api.client.put(
        "/api/v1/config",
        json={
            "openlist": {"base_url": "https://changed.test/subpath", "token": "****"},
            "bt_parser": {"timeout_seconds": 12, "token": "****"},
        },
    )
    assert response.status_code == 200
    api.db.expire_all()
    stored = get_config(api.db, masked=False)
    assert stored["openlist"]["token"] == "test-openlist-token"
    assert stored["openlist"]["password"] == "test-password"
    assert stored["bt_parser"]["service_url"] == "https://metadata.test"
    assert stored["bt_parser"]["token"] == "test-proxy-token"
    assert stored["bt_parser"]["timeout_seconds"] == 12


def test_connection_tests_use_unsaved_values_without_persisting(api):
    before = get_config(api.db, masked=False)
    response = api.client.post(
        "/api/v1/config/test-connection",
        json={
            "base_url": "https://temporary.test/openlist",
            "token": "****",
        },
    )
    assert response.json()["data"]["connected"] is True
    request = next(item for item in api.upstream.requests if item.url.path.endswith("/api/me"))
    assert str(request.url) == "https://temporary.test/openlist/api/me"
    assert request.headers["authorization"] == "test-openlist-token"
    response = api.client.post(
        "/api/v1/config/test-bt-parser",
        json={
            "service_url": "https://temporary.test/bt",
            "token": "temporary-proxy-token",
            "timeout_seconds": 3,
        },
    )
    assert response.json()["data"]["stats"] == {"active_torrents": 2, "active_locks": 1}
    request = api.upstream.requests[-1]
    assert str(request.url) == "https://temporary.test/bt/api/v1/health"
    assert request.headers["authorization"] == "Bearer temporary-proxy-token"
    assert request.extensions["timeout"]["read"] == 3
    api.db.expire_all()
    assert get_config(api.db, masked=False) == before


def test_bt_test_failure_has_own_business_code_and_no_upstream_secrets(api):
    api.upstream.overrides[("GET", "/api/v1/health")] = httpx.Response(500, text="test-secret-in-body")
    response = api.client.post("/api/v1/config/test-bt-parser", json={})
    assert response.status_code == 502 and response.json()["code"] == 50202
    assert "test-secret-in-body" not in response.text


@pytest.mark.parametrize(
    "patch",
    [
        {"openlist": {"base_url": "https://admin:private-password@host.test"}},
        {"openlist": {"token": "private-token\n"}},
        {"bt_parser": {"timeout_seconds": 301, "token": "private-token"}},
        {"probe_paths": [{"group_name": "test", "paths": [{"storage_mount": "/drive", "folder": "/../private-path"}]}]},
    ],
)
def test_invalid_configuration_never_echoes_sensitive_input(api, patch):
    response = api.client.put("/api/v1/config", json=patch)
    assert response.status_code == 422
    assert "private-" not in response.text


def test_storage_ids_native_capacity_and_manual_quota(api):
    response = api.client.get("/api/v1/storages").json()["data"]["storages"][0]
    assert response["id"] == 73 and response["free_space"] == 900
    response = api.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 2000})
    assert response.status_code == 200
    assert response.json()["data"]["free_space"] == 1900
    assert response.json()["data"]["space_source"] == "manual"
    assert api.client.put("/api/v1/storages/1/space", json={"total_space_bytes": 1000}).status_code == 404


def test_unknown_capacity_is_not_zero_or_partial_usage(api):
    api.upstream.storages[0]["mount_details"] = None
    initial = api.client.get("/api/v1/storages").json()["data"]["storages"][0]
    assert initial["free_space"] is None
    api.upstream.overrides[("POST", "/api/fs/list")] = ok(code=403)
    response = api.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 1000})
    storage = response.json()["data"]
    assert storage["total_space"] == 1000
    assert storage["used_space"] is None and storage["free_space"] is None
    assert "目录用量统计失败" in storage["space_error"]


def test_onedrive_manual_quota_queries_native_root_before_recursive_scan(api):
    api.upstream.storages[0]["mount_details"] = None
    api.upstream.overrides[("POST", "/api/fs/get")] = ok(
        {
            "name": "drive",
            "is_dir": True,
            "size": 0,
            "mount_details": {"total_space": 1000, "used_space": 350, "free_space": 650},
        }
    )
    response = api.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 2000})
    assert response.status_code == 200
    storage = response.json()["data"]
    assert storage["used_space"] == 350 and storage["free_space"] == 1650
    assert storage["space_error"] is None
    assert all(request.url.path != "/api/fs/list" for request in api.upstream.requests)


def test_disabled_onedrive_usage_reports_actionable_reason_without_addition_secrets(api):
    api.upstream.storages[0].update(
        mount_details=None,
        addition=json.dumps({"disable_disk_usage": True, "refresh_token": "private-refresh-token"}),
    )
    api.upstream.overrides[("POST", "/api/fs/list")] = ok(code=403)
    response = api.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 1000})
    assert response.json()["data"]["free_space"] is None
    assert "disable_disk_usage" in response.json()["data"]["space_error"]
    assert "private-refresh-token" not in response.text
    assert all(request.url.path != "/api/fs/get" for request in api.upstream.requests)


def test_unlimited_google_drive_quota_does_not_appear_as_full(api):
    api.upstream.storages[0].update(
        driver="GoogleDrive",
        mount_details={
            "total_space": 0,
            "used_space": 350,
            "free_space": -350,
        },
    )
    storage = api.client.get("/api/v1/storages").json()["data"]["storages"][0]
    assert storage["total_space"] is None and storage["free_space"] is None
    assert storage["used_space"] == 350
    storage = api.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 1000}).json()["data"]
    assert storage["free_space"] == 650


def test_nested_mount_prevents_incorrect_quota_scan(api):
    api.upstream.storages[0]["mount_details"] = None
    api.upstream.storages.append({"id": 99, "mount_path": "/drive/nested", "status": "work"})
    response = api.client.put("/api/v1/storages/73/space", json={"total_space_bytes": 1000})
    assert response.json()["data"]["free_space"] is None
    assert "独立子挂载" in response.json()["data"]["space_error"]
    assert all(request.url.path != "/api/fs/list" for request in api.upstream.requests)


def test_storage_group_crud_matches_longest_mount_and_flushes_old_paths(api):
    api.upstream.storages.append({"id": 109, "mount_path": "/drive/nested", "status": "work"})
    response = api.client.post(
        "/api/v1/storage-groups",
        json={
            "name": "media",
            "storage_paths": ["/drive/nested/Video", "/drive/Other"],
        },
    )
    assert response.status_code == 201
    group = response.json()["data"]
    nested = next(path for path in group["paths"] if path["storage_mount"] == "/drive/nested")
    assert nested["folder_path"] == "/Video"
    response = api.client.put(f"/api/v1/storage-groups/{group['id']}", json={"storage_paths": group["storage_paths"]})
    assert response.status_code == 200
    assert api.client.get("/api/v1/storage-groups").json()["data"]["groups"][0]["paths"]
    assert api.client.delete(f"/api/v1/storage-groups/{group['id']}").status_code == 200
    assert api.client.get("/api/v1/storage-groups").json()["data"]["groups"] == []


def test_direct_directory_works_without_metadata_or_capacity_and_adds_no_subfolder(api):
    api.upstream.storages[0]["mount_details"] = None
    api.upstream.overrides[("POST", "/api/v1/metadata")] = httpx.Response(504)
    api.upstream.overrides[("POST", "/api/fs/get")] = ok(code=404)
    response = post_download(api, [{"magnet": MAGNET, "code": "ABC-123", "target_path": "/drive/New"}])
    assert len(response["submitted"]) == 1 and not response["failed"]
    assert response["submitted"][0]["metadata_fallback"] is True
    assert api.upstream.submissions[0]["path"] == "/drive/New"
    assert api.db.query(DownloadTask).one().target_path == "/drive/New"


def test_automatic_scheduling_uses_full_size_and_reserves_previous_requests(api):
    api.upstream.storages.append(
        {
            "id": 99,
            "mount_path": "/small",
            "status": "work",
            "mount_details": {"free_space": 550},
        }
    )
    group = StorageGroup(
        name="media",
        paths=[
            StorageGroupPath(storage_mount="/drive", folder_path="/Video"),
            StorageGroupPath(storage_mount="/small", folder_path="/Video"),
        ],
    )
    api.db.add(group)
    api.db.commit()
    parsed = api.client.post("/api/v1/magnets/parse", json={"magnet_links": [MAGNET]}).json()["data"]["results"][0]
    assert parsed["total_size"] == 600 and parsed["total_files_count"] == 2
    assert sum(file["size"] for file in parsed["files"]) == 500
    response = post_download(api, [{"magnet": MAGNET, "code": "ABC-123", "total_size": 0, "target_group": group.id}])
    assert response["submitted"][0]["target_path"] == "/drive/Video"
    assert response["submitted"][0]["total_size"] == 600
    second = MAGNET.replace(HASH, "a" * 40)
    response = post_download(api, [{"magnet": second, "code": "ABC-124", "total_size": 1, "target_group": group.id}])
    assert not response["submitted"] and response["failed"]
    assert len(api.upstream.submissions) == 1


def test_batch_failure_keeps_previously_submitted_task(api):
    response = post_download(
        api,
        [
            {"magnet": MAGNET, "code": "ABC-123", "target_path": "/drive/Video"},
            {"magnet": MAGNET.replace(HASH, "b" * 40), "code": "ABC-124", "target_path": "/drive2/Video"},
        ],
    )
    assert len(response["submitted"]) == len(response["failed"]) == 1
    assert response["failed"][0]["index"] == 1
    assert api.db.query(DownloadTask).one().openlist_task_id == "upstream-1"


def test_unknown_submission_is_not_retried_even_when_dn_changes(api):
    calls = []

    def timeout(request):
        calls.append(request)
        raise httpx.ReadTimeout("private-upstream-error", request=request)

    api.upstream.overrides[("POST", "/api/fs/add_offline_download")] = timeout
    task = {"magnet": MAGNET, "code": "ABC-123", "target_path": "/drive/Video"}
    response = post_download(api, [task])
    assert response["failed"][0]["reason"] == "submission_unknown"
    stored = api.db.query(DownloadTask).one()
    assert stored.status == "pending" and stored.openlist_task_id is None
    assert "private-upstream-error" not in stored.error_message
    task.update(magnet=MAGNET.replace("ABC-123", "Changed-name"), force=True)
    response = post_download(api, [task])
    assert response["skipped"][0]["reason"] == "already_submitted"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "state,status",
    [
        (0, "pending"),
        (1, "downloading"),
        (2, "completed"),
        (3, "downloading"),
        (4, "cancelled"),
        (5, "pending"),
        (6, "downloading"),
        (7, "failed"),
        (8, "pending"),
        (9, "pending"),
    ],
)
def test_sync_uses_numeric_state_and_never_fabricates_library_files(api, state, status):
    local = add_local_task(api)
    api.upstream.tasks["task-1"] = remote_task("task-1", state)
    response = api.client.post("/api/v1/tasks/sync").json()["data"]
    assert response["synced_count"] == 1
    assert response["completed_count"] == int(state == 2)
    task = response["updated_tasks"][0]
    assert task["status"] == status and task["task_id"] == local.task_id
    assert task["phase"] == "offline_download" and task["downloaded_size_is_estimate"] is True
    assert task["speed"] is None
    assert api.db.query(CodeRecord).count() == 0


def test_missing_upstream_task_remains_pending_instead_of_completed(api):
    local = add_local_task(api)
    api.upstream.tasks.clear()
    response = api.client.post("/api/v1/tasks/sync").json()["data"]
    assert response["synced_count"] == 1 and response["completed_count"] == 0
    assert response["updated_tasks"][0]["status"] == "downloading"
    assert "清理" in response["updated_tasks"][0]["error_message"]
    assert api.client.get(f"/api/v1/tasks/{local.task_id}").status_code == 200


def test_cancel_failure_does_not_change_local_state_and_success_waits_for_confirmation(api):
    local = add_local_task(api)
    api.upstream.overrides[("POST", "/api/task/offline_download/cancel")] = ok(code=403)
    assert api.client.delete(f"/api/v1/tasks/{local.task_id}").status_code == 502
    api.db.refresh(local)
    assert local.status == "downloading" and local.progress == 0
    del api.upstream.overrides[("POST", "/api/task/offline_download/cancel")]
    response = api.client.delete(f"/api/v1/tasks/{local.task_id}").json()["data"]
    assert response["cancel_requested"] is True and response["deleted"] is False
    api.db.refresh(local)
    assert local.status == "downloading" and "等待" in local.error_message
    assert api.client.delete(f"/api/v1/tasks/{local.task_id}?delete_files=true").status_code == 400


def test_transfers_are_separate_and_cancel_uses_transfer_endpoint(api):
    api.upstream.transfers["transfer-1"] = remote_task("transfer-1")
    response = api.client.get("/api/v1/tasks/transfers").json()["data"]["items"]
    assert len(response) == 1 and response[0]["phase"] == "offline_download_transfer"
    assert "parent_task_id" not in response[0]
    assert api.db.query(DownloadTask).count() == 0
    response = api.client.delete("/api/v1/tasks/transfers/transfer-1")
    assert response.json()["data"]["cancel_requested"] is True
    request = api.upstream.requests[-1]
    assert request.url.path == "/api/task/offline_download_transfer/cancel"
    assert request.url.params["tid"] == "transfer-1" and request.content == b""
    api.upstream.transfers["transfer-1"]["state"] = 2
    assert api.client.delete("/api/v1/tasks/transfers/transfer-1").status_code == 409


@pytest.mark.parametrize("path", ["relative", "/drive/../escape", "/drive\\escape", "/drive/\x00bad"])
def test_invalid_download_paths_are_rejected_before_upstream_requests(api, path):
    response = api.client.post(
        "/api/v1/magnets/batch-download",
        json={
            "tasks": [
                {
                    "magnet": MAGNET,
                    "code": "ABC-123",
                    "target_path": path,
                }
            ]
        },
    )
    assert response.status_code == 422
    assert api.upstream.requests == []
