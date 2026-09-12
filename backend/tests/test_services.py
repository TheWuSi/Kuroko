from types import SimpleNamespace

import httpx

from app.models.storage import StorageGroup, StorageGroupPath
from app.services import magnet_metadata_client
from app.services.magnet_metadata_client import MagnetMetadataApiClient
from app.services.storage_service import choose_target


def test_metadata_client_normalizes_upstream_payload(monkeypatch):
    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"info_hash": "abc", "name": "ABC-123", "files": [{"path": "ABC-123/video.mkv", "size": "12"}]}

    monkeypatch.setattr(magnet_metadata_client.httpx, "request", lambda *args, **kwargs: Response())
    result = MagnetMetadataApiClient("http://metadata:8080").fetch_metadata("magnet:?xt=urn:btih:abc")
    assert result["metadata_fallback"] is False
    assert result["files"] == [{"name": "ABC-123/video.mkv", "path": "ABC-123/video.mkv", "size": 12, "offset": 0}]


def test_metadata_client_falls_back_on_timeout(monkeypatch):
    def fail(*args, **kwargs):
        raise httpx.ReadTimeout("timeout")

    monkeypatch.setattr(magnet_metadata_client.httpx, "request", fail)
    result = MagnetMetadataApiClient("http://metadata:8080").parse_with_fallback(
        "magnet:?xt=urn:btih:0123456789012345678901234567890123456789&dn=ABC-123"
    )
    assert result["metadata_fallback"] is True
    assert result["fallback_reason"] == "bt_metadata_timeout"
    assert result["name"] == "ABC-123"


def test_choose_target_uses_best_fit(monkeypatch):
    group = StorageGroup(name="media")
    group.paths = [
        StorageGroupPath(storage_mount="/a", folder_path="/video"),
        StorageGroupPath(storage_mount="/b", folder_path="/video"),
    ]
    monkeypatch.setattr(
        "app.services.storage_service.storage_info",
        lambda db: [
            {"mount_path": "/a", "free_space": 900},
            {"mount_path": "/b", "free_space": 500},
        ],
    )
    path, free = choose_target(SimpleNamespace(), group, 400)
    assert path == "/b/video"
    assert free == 500
