import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from app.services.openlist_client import OpenListClient
from app.services.read_cache import ReadCache


def test_shared_reads_are_cached_refreshed_and_isolated_by_credentials(monkeypatch):
    clock = [1.0]
    monkeypatch.setattr("app.services.read_cache.time.monotonic", lambda: clock[0])
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "code": 200,
                "data": {
                    "total": 1,
                    "content": [
                        {"id": 1, "mount_path": "/drive", "driver": "test", "status": "work"},
                    ],
                },
            },
        )

    cache = ReadCache()
    config = {"base_url": "https://openlist.test", "token": "test-token"}
    transport = httpx.MockTransport(handle)
    with OpenListClient(config, transport=transport, cache=cache) as first:
        result = first.get_storage_info()
        result[0]["mount_path"] = "/changed-by-caller"
    with OpenListClient(config, transport=transport, cache=cache) as second:
        assert second.get_storage_info()[0]["mount_path"] == "/drive"
        assert len(requests) == 1
        second.get_storage_info(refresh=True)
        assert len(requests) == 2
        clock[0] += 31
        second.get_storage_info()
        assert len(requests) == 3
    with OpenListClient({**config, "token": "different-token"}, transport=transport, cache=cache) as changed:
        changed.get_storage_info()
    assert len(requests) == 4


def test_concurrent_reads_share_one_request_and_errors_are_not_cached():
    cache = ReadCache()
    entered = threading.Event()
    release = threading.Event()
    calls = []

    def load():
        calls.append(True)
        entered.set()
        assert release.wait(5)
        return [{"path": "/drive"}]

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(cache.get, ("directory",), load, ttl=30) for _ in range(3)]
        assert entered.wait(5)
        release.set()
        results = [future.result(timeout=5) for future in futures]
    assert len(calls) == 1
    results[0][0]["path"] = "/changed"
    assert results[1][0]["path"] == "/drive"

    def fail():
        raise ValueError("read failed")

    with pytest.raises(ValueError):
        cache.get(("failure",), fail, ttl=30)
    assert cache.get(("failure",), lambda: "recovered", ttl=30) == "recovered"


def test_cached_login_is_reused_and_reauthenticated_once_when_expired():
    logins = []
    expire = [False]

    def handle(request):
        if request.url.path == "/api/auth/login":
            logins.append(True)
            return httpx.Response(200, json={"code": 200, "data": {"token": "token-" + str(len(logins))}})
        if expire[0] and request.headers.get("authorization") == "token-1":
            return httpx.Response(200, json={"code": 401, "data": None})
        return httpx.Response(200, json={"code": 200, "data": {"is_dir": True, "name": "directory", "size": 0}})

    config = {
        "base_url": "https://openlist.test",
        "auth_type": "password",
        "username": "tester",
        "password": "test-only",
    }
    cache = ReadCache()
    transport = httpx.MockTransport(handle)
    with OpenListClient(config, cache=cache, transport=transport) as client:
        client.get_file("/first")
    with OpenListClient(config, cache=cache, transport=transport) as client:
        client.get_file("/second")
        assert len(logins) == 1
        expire[0] = True
        client.get_file("/third")
    assert len(logins) == 2


def test_cache_is_bounded_and_clear_prevents_stale_results():
    cache = ReadCache(max_entries=2)
    for value in range(3):
        assert cache.get((value,), lambda: value, ttl=30) == value
    assert cache.get((0,), lambda: "evicted", ttl=30) == "evicted"
    cache.clear()
    assert cache.get((0,), lambda: "fresh", ttl=30) == "fresh"
