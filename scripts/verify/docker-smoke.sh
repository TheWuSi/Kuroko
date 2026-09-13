#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:-}"
if [[ $# -ne 1 || -z "$image" || ${#image} -gt 512 || "$image" == -* || "$image" == *[[:space:]]* ]]; then
  printf '用法：bash scripts/verify/docker-smoke.sh <本地镜像>\n' >&2
  exit 2
fi
docker image inspect "$image" >/dev/null

container_id=""
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$container_id" ]]; then
    if (( status != 0 )); then
      docker logs "$container_id" >&2 || true
    fi
    docker rm --force --volumes "$container_id" >/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 密钥只通过环境传递；匿名数据卷与隔离网络避免接触本机数据或真实上游。
smoke_secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
container_id="$(KUROKO_SECRET_KEY="$smoke_secret" docker create --pull=never \
  --network none \
  --env KUROKO_ENVIRONMENT=production \
  --env KUROKO_SECRET_KEY \
  --env KUROKO_DATABASE_URL=sqlite:////app/data/kuroko.db \
  --env KUROKO_TASK_POLL_SECONDS=3600 \
  "$image")"
unset smoke_secret

verify_startup() {
  docker exec -i "$container_id" python - "$1" <<'PY'
import json
import sqlite3
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from alembic.config import Config
from alembic.script import ScriptDirectory

base_url = "http://127.0.0.1:8000"
deadline = time.monotonic() + 60
while True:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RuntimeError("容器未在 60 秒内就绪")
    try:
        with urlopen(base_url + "/api/v1/health", timeout=min(2, remaining)) as response:
            health = json.load(response)
        if health.get("code") != 0 or health.get("data", {}).get("status") != "ok":
            raise RuntimeError("健康接口响应不符合预期")
        break
    except (URLError, TimeoutError, ConnectionError):
        time.sleep(min(1, max(0, deadline - time.monotonic())))

index_html = Path("/app/static/index.html").read_bytes()
if not index_html:
    raise RuntimeError("镜像中的前端首页为空")
with urlopen(base_url + "/", timeout=5) as response:
    if response.headers.get_content_type() != "text/html" or response.read() != index_html:
        raise RuntimeError("首页未提供镜像中的前端构建产物")

config = Config("/app/alembic.ini")
config.set_main_option("script_location", "/app/alembic")
heads = set(ScriptDirectory.from_config(config).get_heads())
if not heads:
    raise RuntimeError("镜像中没有数据库迁移版本")

# 写入真实配置表，重启后读取，避免数据库被重建仍误判为迁移成功。
marker_key = "_docker_smoke_test"
marker_value = json.dumps("startup-and-restart")
with sqlite3.connect("file:/app/data/kuroko.db?mode=rw", uri=True) as connection:
    versions = {row[0] for row in connection.execute("SELECT version_num FROM alembic_version")}
    if versions != heads:
        raise RuntimeError("数据库未迁移到镜像中的最新版本")
    marker = connection.execute("SELECT value FROM system_configs WHERE key = ?", (marker_key,)).fetchone()
    if sys.argv[1] == "initial":
        if marker is not None:
            raise RuntimeError("首次启动必须使用独立的空数据库")
        connection.execute("INSERT INTO system_configs (key, value) VALUES (?, ?)", (marker_key, marker_value))
    elif marker != (marker_value,):
        raise RuntimeError("容器重启后数据库记录丢失")

print("容器检查通过：" + sys.argv[1])
PY
}

docker start "$container_id" >/dev/null
verify_startup initial
docker restart --timeout 10 "$container_id" >/dev/null
verify_startup restart
