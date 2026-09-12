"""有界的短时读取缓存；同一键的并发请求共享结果，失败不会缓存。"""

import time
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from copy import deepcopy
from threading import Lock
from typing import Any


class ReadCache:
    def __init__(self, max_entries: int = 256):
        self.max_entries = max_entries
        self._values: OrderedDict[tuple, tuple[float, Any]] = OrderedDict()
        self._pending: dict[tuple, Future] = {}
        self._lock = Lock()
        self._generation = 0

    def clear(self) -> None:
        with self._lock:
            self._generation += 1
            self._values.clear()

    def get(self, key: tuple, load: Callable[[], Any], *, ttl: float, refresh: bool = False) -> Any:
        with self._lock:
            cached = self._values.get(key)
            if not refresh and cached is not None and cached[0] > time.monotonic():
                self._values.move_to_end(key)
                return deepcopy(cached[1])
            generation = self._generation
            pending_key = (generation, key)
            future = self._pending.get(pending_key)
            owner = future is None
            if owner:
                future = Future()
                self._pending[pending_key] = future
        if not owner:
            return deepcopy(future.result())
        try:
            value = load()
            with self._lock:
                # 大目录仍完整返回，但不长期占据内存；刷新期间清空缓存后也不回填旧值。
                if generation == self._generation and not (isinstance(value, list) and len(value) > 2000):
                    self._values[key] = (time.monotonic() + ttl, deepcopy(value))
                    self._values.move_to_end(key)
                    while len(self._values) > self.max_entries:
                        self._values.popitem(last=False)
            future.set_result(value)
            return deepcopy(value)
        except BaseException as exc:
            future.set_exception(exc)
            raise
        finally:
            with self._lock:
                self._pending.pop(pending_key, None)


openlist_read_cache = ReadCache()
