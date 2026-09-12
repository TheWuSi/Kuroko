import json

import httpx
import pytest

from app.services.magnet_metadata_client import MagnetMetadataApiClient, MagnetMetadataError
from app.services.openlist_client import OpenListClient, OpenListError

HASH = "0123456789abcdef0123456789abcdef01234567"
MAGNET = f"magnet:?xt=urn:btih:{HASH}&dn=ABC-123"


def ok(data=None, code=200):
    return httpx.Response(200, json={"code": code, "message": "success", "data": data})


def openlist(handler, **config):
    return OpenListClient(
        {"base_url": "https://openlist.test/list", "token": "admin-test-token", **config},
        transport=httpx.MockTransport(handler),
    )


def test_openlist_uses_raw_authorization_and_preserves_url_prefix():
    def handler(request):
        assert request.method == "GET"
        assert request.url.path == "/list/api/me"
        assert request.headers["authorization"] == "admin-test-token"
        return ok({"role": 2})

    with openlist(handler, token="Bearer admin-test-token") as client:
        assert client._request("GET", "/api/me")["role"] == 2


@pytest.mark.parametrize("http_status", [200, 401])
def test_password_login_before_request_and_one_refresh_on_expiration(http_status):
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/auth/login"):
            assert "authorization" not in request.headers
            assert json.loads(request.content) == {"username": "admin", "password": "login-password"}
            return ok({"token": f"token-{len(calls)}"})
        if len(calls) == 2:
            return httpx.Response(http_status, json={"code": 401, "message": "expired"})
        assert request.headers["authorization"] == "token-3"
        return ok({"role": 2})

    with openlist(handler, auth_type="password", username="admin", password="login-password") as client:
        assert client._request("GET", "/api/me") == {"role": 2}
    assert len(calls) == 4


def test_password_auth_does_not_retry_forever_or_accept_guest():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return ok({"token": "new-token"}) if request.url.path.endswith("/login") else ok(code=401)

    with openlist(handler, auth_type="password", username="admin", password="login-password") as client:
        with pytest.raises(OpenListError, match="鉴权失败"):
            client._request("GET", "/api/me")
    assert len(calls) == 4
    with openlist(lambda request: ok({"role": 1})) as client:
        with pytest.raises(OpenListError, match="管理员"):
            client.test_connection()


@pytest.mark.parametrize("payload", [{"code": 403, "message": "credential-secret"}, {}, []])
def test_openlist_rejects_business_errors_and_malformed_envelopes(payload):
    with openlist(lambda request: httpx.Response(200, json=payload)) as client:
        with pytest.raises(OpenListError) as exc:
            client._request("GET", "/api/me")
    assert "credential-secret" not in str(exc.value)


def test_directory_pagination_and_null_empty_directory():
    pages = []

    def handler(request):
        body = json.loads(request.content)
        assert request.method == "POST"
        assert request.url.path.endswith("/api/fs/list")
        assert body["per_page"] == 100
        assert body["password"] == "" and body["refresh"] is False
        if body["path"] == "/empty":
            return ok({"content": None, "total": 0})
        pages.append(body["page"])
        start = (body["page"] - 1) * 100
        files = [{"name": f"file-{i}.mkv", "size": i, "is_dir": False} for i in range(start, min(start + 100, 201))]
        return ok({"content": files, "total": 201})

    with openlist(handler) as client:
        assert len(client.list_files("/media")) == 201
        assert client.list_files("/empty") == []
    assert pages == [1, 2, 3]


@pytest.mark.parametrize("content,total", [([], 1), ([{"name": "../escape", "is_dir": True, "size": 0}], 1)])
def test_directory_does_not_accept_partial_results_or_traversal(content, total):
    with openlist(lambda request: ok({"content": content, "total": total})) as client:
        with pytest.raises(OpenListError):
            client.list_files("/media")


def test_storage_list_preserves_ids_and_mount_details_without_exposing_addition():
    def handler(request):
        assert dict(request.url.params) == {"page": "1", "per_page": "100"}
        return ok({"total": 1, "content": [{
            "id": 73, "mount_path": "/cloud/nested", "driver": "PikPak", "status": "work", "disabled": False,
            "addition": '{"password":"do-not-expose"}',
            "mount_details": {"total_space": 1000, "used_space": 300, "free_space": 700},
        }]})

    with openlist(handler) as client:
        storage = client.get_storage_info()[0]
    assert storage["id"] == 73 and storage["mount_details"]["free_space"] == 700
    assert "addition" not in storage


def test_download_contract_uses_exact_tool_policy_directory_and_tasks_array():
    def handler(request):
        body = json.loads(request.content)
        assert request.method == "POST"
        assert request.url.path.endswith("/api/fs/add_offline_download")
        assert body["path"] == "/cloud/Downloads"
        assert body["tool"] == "PikPak"
        assert body["delete_policy"] == "delete_always"
        assert len(body["urls"]) == 1 and "tr=" not in body["urls"][0]
        return ok({"tasks": [{"id": "openlist-task-42", "state": 0, "progress": 0}]})

    with openlist(handler) as client:
        assert client.add_offline_download(MAGNET + "&tr=https://tracker.test", "/cloud/Downloads") == "openlist-task-42"


@pytest.mark.parametrize("malformed", [False, True])
def test_uncertain_submission_is_not_retried(malformed):
    calls = []

    def handler(request):
        calls.append(request)
        if malformed:
            return ok({"task_id": "obsolete-shape"})
        raise httpx.ReadTimeout("secret-upstream-url", request=request)

    with openlist(handler) as client:
        with pytest.raises(OpenListError) as exc:
            client.add_offline_download(MAGNET, "/cloud/Downloads")
    assert exc.value.outcome_unknown is True
    assert len(calls) == 1
    assert "secret-upstream-url" not in str(exc.value)


def test_task_lists_info_and_cancel_use_category_and_query_tid():
    calls = []
    remote = {"id": "task-1", "state": 2, "status": "transferring", "progress": 100, "total_bytes": 10}

    def handler(request):
        calls.append((request.method, request.url.path))
        if request.url.path.endswith("/undone"):
            return ok([])
        if request.url.path.endswith("/done"):
            return ok([remote])
        assert request.method == "POST"
        assert request.url.params["tid"] == "task-1"
        assert request.content == b""
        return ok(remote if request.url.path.endswith("/info") else None)

    with openlist(handler) as client:
        assert client.get_offline_tasks(["task-1"])[0]["state"] == 2
        assert client.get_task("task-1")["id"] == "task-1"
        client.cancel_task("task-1", kind="offline_download_transfer")
    assert calls[-1][1] == "/list/api/task/offline_download_transfer/cancel"


def metadata(handler):
    return MagnetMetadataApiClient("https://metadata.test/prefix", transport=httpx.MockTransport(handler))


def test_metadata_request_and_multifile_response():
    def handler(request):
        assert request.method == "POST" and request.url.path == "/prefix/api/v1/metadata"
        assert "authorization" not in request.headers
        assert set(json.loads(request.content)) == {"magnet_uri"}
        return httpx.Response(200, json={
            "info_hash": HASH, "name": "ABC-123", "size": 101,
            "files": [{"path": "video.mkv", "size": 100, "offset": 0}, {"path": "readme.txt", "size": 1, "offset": 100}],
        })

    with metadata(handler) as client:
        result = client.fetch_metadata(MAGNET)
    assert result["size"] == 101 and result["files"][1]["path"] == "readme.txt"
    assert result["files"][0]["name"] == "video.mkv"


def test_single_file_torrent_uses_name_and_size():
    with metadata(lambda request: httpx.Response(200, json={
        "info_hash": HASH, "name": "ABC-123.mkv", "size": 42, "files": [],
    })) as client:
        result = client.fetch_metadata(MAGNET)
    assert result["files"] == [{"name": "ABC-123.mkv", "path": "ABC-123.mkv", "size": 42, "offset": 0}]


@pytest.mark.parametrize("change", [
    {"info_hash": "f" * 40},
    {"files": [{"path": "../escape.mkv", "size": 42}]},
    {"files": [{"path": "video.mkv", "size": -1}]},
    {"files": [{"path": "video.mkv", "size": "42"}]},
    {"files": [{"path": "video.mkv", "size": 41}]},
    {"size": True},
])
def test_invalid_metadata_is_reported_as_fallback_not_success(change):
    payload = {"info_hash": HASH, "name": "ABC-123.mkv", "size": 42, "files": [], **change}
    with metadata(lambda request: httpx.Response(200, json=payload)) as client:
        result = client.parse_with_fallback(MAGNET)
    assert result["metadata_fallback"] is True
    assert result["fallback_reason"] == "bt_metadata_invalid_response"
    assert result["files"] == []


@pytest.mark.parametrize("status,reason", [(504, "bt_metadata_timeout"), (500, "bt_metadata_unavailable"), (400, "bt_metadata_invalid_request")])
def test_metadata_http_errors_have_distinct_fallback_reasons(status, reason):
    with metadata(lambda request: httpx.Response(status, json={"error": "failure"})) as client:
        assert client.parse_with_fallback(MAGNET)["fallback_reason"] == reason


def test_health_uses_real_endpoint_and_returns_only_actual_statistics():
    def handler(request):
        assert request.method == "GET" and request.url.path == "/prefix/api/v1/health"
        return httpx.Response(200, json={"status": "ok", "stats": {"active_torrents": 3, "active_locks": 1, "cache_dir": "/private"}})

    with metadata(handler) as client:
        result = client.test_connection()
    assert result["stats"] == {"active_torrents": 3, "active_locks": 1}
    assert "dht_connected" not in result


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="<html>fallback</html>"),
    httpx.Response(200, json={"status": "error", "stats": {}}),
    httpx.Response(404),
])
def test_health_does_not_accept_a_spa_or_invalid_health_response(response):
    with metadata(lambda request: response) as client:
        with pytest.raises(MagnetMetadataError):
            client.test_connection()
