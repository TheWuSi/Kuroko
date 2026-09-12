"""OpenList 虚拟路径校验，避免挂载匹配和目录遍历越界。"""

from pathlib import PurePosixPath


def normalize_path(value: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or len(value) > 1024
        or "\\" in value
        or ".." in value.split("/")
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise ValueError("存储路径必须是有效的绝对路径，且不可包含 ..、反斜线或控制字符")
    return "/" + str(PurePosixPath(value)).lstrip("/")


def is_within(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def join_path(mount: str, folder: str) -> str:
    return normalize_path(normalize_path(mount).rstrip("/") + normalize_path(folder))


def child_path(parent: str, name: str) -> str:
    if not isinstance(name, str) or not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise ValueError("上游返回了无效的文件名")
    return normalize_path(parent.rstrip("/") + "/" + name)
