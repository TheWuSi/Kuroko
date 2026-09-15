"""验证源码、发布镜像和无 Git 信息的源码包使用一致的版本规则。"""

import subprocess

import pytest
from fastapi.testclient import TestClient

from app.core import version
from app.main import app


@pytest.mark.parametrize(
    ("value", "expected"),
    [("v0.5.0", "0.5.0"), ("1.2.3", "1.2.3"), ("v1.2.3-rc.1+build.7", "1.2.3-rc.1+build.7")],
)
def test_normalize_version(value, expected):
    assert version.normalize_version(value) == expected


@pytest.mark.parametrize(
    "value", [None, 5, "", "latest", "v01.2.3", "v1.2", "v1.2.3-rc.01", "v1.2.3\n", "1.2.3+<script>", "1" * 129]
)
def test_invalid_version(value):
    assert version.normalize_version(value) is None


def test_version_sources(monkeypatch, tmp_path):
    project = tmp_path / "backend"
    project.mkdir()
    (project / "pyproject.toml").write_text('[project]\nversion = "0.5.0"\n', encoding="utf-8")
    monkeypatch.setattr(version, "PROJECT_DIR", project)
    monkeypatch.delenv("KUROKO_VERSION", raising=False)
    assert version.get_version() == "0.5.0"

    def git(*args):
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    def commit(message):
        git(
            "-c", "user.name=Kuroko Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
            "commit", "--allow-empty", "-m", message,
        )

    git("init")
    commit("版本测试")
    git("tag", "v0.6.0")
    assert version.get_version() == "0.6.0"
    commit("版本后的开发提交")
    assert version.get_version() == "0.6.0"
    monkeypatch.setenv("KUROKO_VERSION", "v0.7.0-rc.1")
    assert version.get_version() == "0.7.0-rc.1"
    monkeypatch.setenv("KUROKO_VERSION", "latest")
    with pytest.raises(RuntimeError, match="KUROKO_VERSION"):
        version.get_version()


def test_health_and_openapi_share_release_version():
    client = TestClient(app)
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["data"] == {"status": "ok", "version": app.version}
    assert client.get("/openapi.json").json()["info"]["version"] == app.version
    assert app.version == version.get_version()
