"""以轻量版本通知展示缓存失效，不把浏览器长期快照用于容量调度。"""

import hashlib
import json
import threading
import uuid

from app.services.read_cache import openlist_read_cache


class StorageEvents:
    def __init__(self):
        self._lock = threading.Lock()
        self._source_id = uuid.uuid4().hex
        self._revision = 0
        self._transfer_signature: str | None = None

    def current(self) -> dict:
        with self._lock:
            return {"source_id": self._source_id, "revision": self._revision}

    def invalidate(self, *, source_changed: bool = False) -> None:
        with self._lock:
            if source_changed:
                self._source_id = uuid.uuid4().hex
                self._transfer_signature = None
            self._revision += 1
            openlist_read_cache.clear()

    def observe_transfers(self, tasks: list[dict], source_id: str) -> None:
        terminal = sorted(
            (item["id"], item["state"], str(item.get("end_time") or "")[:64])
            for item in tasks
            if item.get("state") in {2, 4, 7}
        )
        # 仅保存固定大小摘要，不随 OpenList 已结束任务的数量增长；连续读取同一终态不会重复刷新。
        signature = hashlib.sha256(json.dumps(terminal).encode()).hexdigest()
        with self._lock:
            if source_id != self._source_id:
                return
            changed = signature != self._transfer_signature and (bool(terminal) or self._transfer_signature is not None)
            self._transfer_signature = signature
            if changed:
                self._revision += 1
                openlist_read_cache.clear()


storage_events = StorageEvents()
