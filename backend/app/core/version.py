"""发布版本跟随 Git tag，脱离仓库的镜像通过构建参数保留版本。"""

import os
import re
import subprocess
import tomllib
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[2]
VERSION_PATTERN = re.compile(
    r"v?((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)"
)


def normalize_version(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 128:
        return None
    match = VERSION_PATTERN.fullmatch(value)
    if match is None:
        return None
    if match[2] and any(re.fullmatch(r"0[0-9]+", part) for part in match[2].split(".")):
        return None
    return match[1]


def get_version() -> str:
    if version := os.environ.get("KUROKO_VERSION"):
        normalized = normalize_version(version)
        if normalized is None:
            raise RuntimeError("KUROKO_VERSION 必须是有效的版本标签，例如 v0.5.0")
        return normalized

    # 仅在当前工程自己的仓库内读取，避免源码包误用父目录中其他项目的 tag。
    if (PROJECT_DIR.parent / ".git").exists():
        try:
            result = subprocess.run(
                ["git", "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--match", "[0-9]*"],
                cwd=PROJECT_DIR.parent,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=2,
                check=True,
            )
            if normalized := normalize_version(result.stdout.strip()):
                return normalized
        except (OSError, subprocess.SubprocessError):
            pass

    with (PROJECT_DIR / "pyproject.toml").open("rb") as source:
        normalized = normalize_version(tomllib.load(source)["project"]["version"])
    if normalized is None:
        raise RuntimeError("后端项目元数据缺少有效版本号")
    return normalized
