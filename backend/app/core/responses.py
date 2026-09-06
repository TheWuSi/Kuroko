"""统一 API 响应。"""

from typing import Any


def success(data: Any = None, message: str = "success") -> dict[str, Any]:
    return {"code": 0, "message": message, "data": data}


def error(code: int, message: str) -> dict[str, Any]:
    return {"code": code, "message": message, "data": None}
