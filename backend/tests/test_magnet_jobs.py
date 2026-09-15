"""真实 JWT、隔离文件数据库与可控上游，验证长任务与提交恢复。"""

import threading
import time
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.core.security import create_token, hash_password
from app.main import app
from app.models.magnet_job import MagnetParseItem, MagnetSubmission, MagnetSubmissionItem
from app.models.task import DownloadTask
from app.models.user import User
from app.services.config_service import update_config
from app.services.magnet_jobs import MagnetJobRunner, recover_jobs
from app.services.magnet_metadata_client import MagnetMetadataError
from app.utils.magnet_parser import magnet_info_hash


def magnet(index):
    return f"magnet:?xt=urn:btih:{index + 1:040x}&dn=ABC-{index + 100}"


def wait_until(predicate, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("后台任务未在测试预算内推进")


class Metadata:
    def __init__(self):
        self.lock = threading.Lock()
        self.calls = Counter()
        self.active = 0
        self.maximum = 0
        self.gates = {}
        self.fallback = set()

    def factory(self, *_args):
        owner = self

        class Parser:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def parse_with_fallback(self, uri):
                index = int(magnet_info_hash(uri), 16) - 1
                with owner.lock:
                    owner.calls[index] += 1
                    owner.active += 1
                    owner.maximum = max(owner.maximum, owner.active)
                try:
                    gate = owner.gates.get(index)
                    if gate is not None:
                        assert gate.wait(10), "测试未放行元数据响应"
                    fallback = index in owner.fallback
                    return {
                        "info_hash": magnet_info_hash(uri),
                        "name": f"ABC-{index + 100}",
                        "size": 0 if fallback else 600,
                        "files": [] if fallback else [{"name": f"ABC-{index + 100}.mkv", "size": 600}],
                        "metadata_fallback": fallback,
                        "fallback_reason": "bt_metadata_timeout" if fallback else None,
                    }
                finally:
                    with owner.lock:
                        owner.active -= 1

        return Parser()


@pytest.fixture
def jobs(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    with sessions() as db:
        users = [User(username=name, hashed_password=hash_password("test-password")) for name in ("first", "second")]
        db.add_all(users)
        update_config(db, {"filter": {"min_file_size_mb": 0}})
        db.commit()
        credentials = [{"Authorization": f"Bearer {create_token(user)[0]}"} for user in users]
        refresh = create_token(users[0], refresh=True)[0]

    def database():
        with sessions() as db:
            yield db

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = database
    client = TestClient(app)  # 后台线程由各测试显式启动，不接触真实 lifespan 和数据库。
    metadata = Metadata()
    runners = []

    def runner(**kwargs):
        kwargs.setdefault("parser_factory", metadata.factory)
        value = MagnetJobRunner(sessions, **kwargs)
        runners.append(value)
        return value

    try:
        yield SimpleNamespace(
            client=client,
            sessions=sessions,
            headers=credentials,
            users=users,
            refresh=refresh,
            metadata=metadata,
            runner=runner,
        )
    finally:
        for value in runners:
            value.stop_event.set()
        for gate in metadata.gates.values():
            gate.set()
        for value in runners:
            for thread in value.threads:
                thread.join(timeout=5)
        client.close()
        app.dependency_overrides = previous
        engine.dispose()


def create_job(api, count=3, request_id=None, links=None):
    body = {
        "request_id": request_id or str(uuid.uuid4()),
        "magnet_links": links or [magnet(index) for index in range(count)],
    }
    response = api.client.post("/api/v1/magnets/parse-jobs", json=body, headers=api.headers[0])
    assert response.status_code == 202, response.text
    return response.json()["data"], body


def get_job(api, job_id):
    return api.client.get(f"/api/v1/magnets/parse-jobs/{job_id}", headers=api.headers[0]).json()["data"]


def submission(api, job_id, indices, request_id=None):
    body = {"request_id": request_id or str(uuid.uuid4()), "item_indices": indices, "target_path": "/drive/Video"}
    response = api.client.post(f"/api/v1/magnets/parse-jobs/{job_id}/submissions", json=body, headers=api.headers[0])
    assert response.status_code == 202, response.text
    return response.json()["data"], body


def test_real_jwt_login_refresh_bootstrap_and_invalid_credentials(jobs):
    client = jobs.client
    response = client.post("/api/v1/auth/login", json={"username": "first", "password": "test-password"})
    tokens = response.json()["data"]
    assert tokens["refresh_token"] and tokens["refresh_expires_at"]
    expired = jwt.encode(
        {"sub": str(jobs.users[0].id), "type": "access", "exp": datetime.now(UTC) - timedelta(seconds=1)},
        get_settings().secret_key.get_secret_value(),
        algorithm="HS256",
    )
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    response = client.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {tokens['refresh_token']}"})
    assert response.status_code == 200
    assert (
        client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {response.json()['data']['token']}"}
        ).status_code
        == 200
    )
    assert client.post("/api/v1/auth/refresh", headers=jobs.headers[0]).status_code == 401
    assert (
        client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code == 401
    )
    assert client.post("/api/v1/auth/refresh", headers={"Authorization": "Bearer invalid"}).status_code == 401
    with jobs.sessions() as db:
        db.query(User).delete()
        db.commit()
    assert (
        client.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code
        == 401
    )
    initialized = client.post("/api/v1/auth/bootstrap", json={"username": "new-admin", "password": "test-password"})
    assert initialized.status_code == 200
    assert initialized.json()["data"]["refresh_token"]


def test_sixty_slow_magnets_progress_order_concurrency_and_relogin(jobs):
    jobs.metadata.gates = {index: threading.Event() for index in range(60)}
    runner = jobs.runner()
    runner.start()
    job, body = create_job(jobs, 60)
    job_id = job["job_id"]
    assert job["status"] in {"pending", "running"} and job["completed"] == 0
    wait_until(lambda: jobs.metadata.active == 4)
    repeated, _ = create_job(jobs, 60, request_id=body["request_id"])
    assert repeated["job_id"] == job_id
    # 第四条先返回，界面可立即读到它，前三条继续等待上游。
    jobs.metadata.gates[3].set()
    wait_until(lambda: get_job(jobs, job_id)["confirmed"] == 1)
    partial = get_job(jobs, job_id)
    assert partial["items"][3]["status"] == "completed"
    assert partial["items"][0]["status"] == "running"
    assert "files" not in partial["items"][3]["summary"]
    detail = jobs.client.get(f"/api/v1/magnets/parse-jobs/{job_id}/items/3", headers=jobs.headers[0]).json()["data"]
    assert detail["result"]["files"]
    assert (
        jobs.client.get(f"/api/v1/magnets/parse-jobs/{job_id}", headers={"Authorization": "Bearer expired"}).status_code
        == 401
    )
    jobs.client.close()
    jobs.client = TestClient(app)
    renewed = jobs.client.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {jobs.refresh}"}).json()[
        "data"
    ]
    jobs.headers[0] = {"Authorization": f"Bearer {renewed['token']}"}
    for gate in jobs.metadata.gates.values():
        gate.set()
    wait_until(lambda: get_job(jobs, job_id)["status"] == "completed")
    finished = get_job(jobs, job_id)
    assert finished["confirmed"] == 60
    assert [item["index"] for item in finished["items"]] == list(range(60))
    assert [item["magnet"] for item in finished["items"]] == body["magnet_links"]
    assert jobs.metadata.maximum == 4
    assert jobs.metadata.calls == Counter({index: 1 for index in range(60)})


def test_cancel_keeps_finished_results_and_resume_only_remaining(jobs):
    jobs.metadata.gates = {index: threading.Event() for index in range(6)}
    runner = jobs.runner()
    runner.start()
    job, _ = create_job(jobs, 6)
    job_id = job["job_id"]
    wait_until(lambda: jobs.metadata.active == 4)
    response = jobs.client.post(f"/api/v1/magnets/parse-jobs/{job_id}/cancel", headers=jobs.headers[0])
    assert response.json()["data"]["cancel_requested"] is True
    for gate in jobs.metadata.gates.values():
        gate.set()
    wait_until(lambda: get_job(jobs, job_id)["status"] == "cancelled")
    assert get_job(jobs, job_id)["confirmed"] == 4
    assert sum(jobs.metadata.calls.values()) == 4
    resumed = jobs.client.post(f"/api/v1/magnets/parse-jobs/{job_id}/resume", headers=jobs.headers[0], json={})
    assert resumed.status_code == 202
    wait_until(lambda: get_job(jobs, job_id)["status"] == "completed")
    assert jobs.metadata.calls == Counter({index: 1 for index in range(6)})


def test_restart_resumes_unfinished_magnets_without_repeating_completed(jobs):
    job, _ = create_job(jobs, 60)
    first = jobs.runner()
    for _ in range(20):
        assert first.parse_once()
    with jobs.sessions() as db:
        item = db.get(MagnetParseItem, (job["job_id"], 20))
        item.status, item.run_token = "running", str(uuid.uuid4())
        db.commit()
    restarted = jobs.runner()
    restarted.start()
    wait_until(lambda: get_job(jobs, job["job_id"])["status"] == "completed")
    assert jobs.metadata.calls == Counter({index: 1 for index in range(60)})
    assert get_job(jobs, job["job_id"])["items"][20]["attempt"] == 2


def test_fallback_is_not_confirmed_metadata_and_retry_keeps_good_items(jobs):
    jobs.metadata.fallback = {1}
    job, _ = create_job(jobs, 2)
    runner = jobs.runner()
    runner.parse_once()
    runner.parse_once()
    result = get_job(jobs, job["job_id"])
    assert result["confirmed"] == result["fallback"] == 1
    jobs.metadata.fallback.clear()
    resumed = jobs.client.post(
        f"/api/v1/magnets/parse-jobs/{job['job_id']}/resume", headers=jobs.headers[0], json={"indices": [1]}
    )
    assert resumed.status_code == 202
    runner.parse_once()
    assert jobs.metadata.calls == Counter({0: 1, 1: 2})


def test_submission_partial_failure_history_idempotency_and_unknown_guard(jobs):
    calls = []

    def send(db, tasks, *, on_task_created):
        payload = tasks[0]
        index = int(magnet_info_hash(payload["magnet"]), 16) - 1
        calls.append(index)
        if index == 1:
            return {
                "submitted": [],
                "skipped": [],
                "failed": [
                    {
                        "index": 0,
                        "magnet": payload["magnet"],
                        "code": payload["code"],
                        "reason": "invalid_target",
                        "message": "位置不可用",
                    }
                ],
            }
        task = DownloadTask(
            code=payload["code"], magnet=payload["magnet"], target_path=payload["target_path"], total_size=600
        )
        db.add(task)
        db.flush()
        on_task_created(task)
        db.commit()
        if index == 2:
            raise RuntimeError("模拟提交响应丢失")
        task.openlist_task_id = "remote-confirmed"
        db.commit()
        return {
            "submitted": [
                {
                    "index": 0,
                    "magnet": payload["magnet"],
                    "code": task.code,
                    "task_id": task.task_id,
                    "target_path": task.target_path,
                    "openlist_task_id": task.openlist_task_id,
                    "total_size": 600,
                    "metadata_fallback": False,
                }
            ],
            "skipped": [],
            "failed": [],
        }

    runner = jobs.runner(submitter=send)
    job, _ = create_job(jobs)
    for _ in range(3):
        runner.parse_once()
    started, body = submission(jobs, job["job_id"], [0, 1, 2])
    repeated, _ = submission(jobs, job["job_id"], [0, 1, 2], body["request_id"])
    assert repeated["submission_id"] == started["submission_id"]
    for _ in range(3):
        assert runner.submit_once()
    assert not runner.submit_once()
    path = f"/api/v1/magnets/submissions/{started['submission_id']}"
    result = jobs.client.get(path, headers=jobs.headers[0]).json()["data"]
    assert result["status"] == "completed"
    assert (result["submitted"], result["failed"], result["unknown"]) == (1, 1, 1)
    assert result["input_links"] == [magnet(index) for index in range(3)]
    assert result["items"][2]["task_id"]
    submission(jobs, job["job_id"], [0, 1, 2], body["request_id"])
    assert not runner.submit_once()
    assert calls == [0, 1, 2]
    assert jobs.client.get(path, headers=jobs.headers[1]).status_code == 404
    assert jobs.client.get("/api/v1/magnets/submissions", headers=jobs.headers[1]).json()["data"]["items"] == []
    assert (
        jobs.client.get(
            "/api/v1/magnets/submissions", params={"request_id": body["request_id"]}, headers=jobs.headers[0]
        ).json()["data"]["total"]
        == 1
    )
    for index in (0, 2):
        rejected = jobs.client.post(
            f"/api/v1/magnets/parse-jobs/{job['job_id']}/submissions",
            headers=jobs.headers[0],
            json={
                "request_id": str(uuid.uuid4()),
                "item_indices": [index],
                "target_path": "/drive/Video",
                "force": True,
            },
        )
        assert rejected.status_code == 409
    second, _ = create_job(jobs, links=[magnet(2)])
    runner.parse_once()
    rejected = jobs.client.post(
        f"/api/v1/magnets/parse-jobs/{second['job_id']}/submissions",
        headers=jobs.headers[0],
        json={
            "request_id": str(uuid.uuid4()),
            "item_indices": [0],
            "target_path": "/drive/Video",
        },
    )
    assert rejected.status_code == 409


def test_restart_verifies_committed_tasks_and_never_replays_uncertain_submission(jobs):
    calls = []

    def send(_db, tasks, **_kwargs):
        calls.append(tasks[0]["magnet"])
        return {
            "submitted": [],
            "skipped": [],
            "failed": [
                {
                    "index": 0,
                    "magnet": tasks[0]["magnet"],
                    "code": tasks[0]["code"],
                    "reason": "invalid_target",
                    "message": "位置不可用",
                }
            ],
        }

    runner = jobs.runner(submitter=send)
    job, _ = create_job(jobs)
    for _ in range(3):
        runner.parse_once()
    started, _ = submission(jobs, job["job_id"], [0, 1, 2])
    with jobs.sessions() as db:
        parent = db.get(MagnetSubmission, started["submission_id"])
        parent.status = "running"
        for index in (0, 1):
            task = DownloadTask(
                code=f"ABC-{index + 100}",
                magnet=magnet(index),
                target_path="/drive/Video",
                total_size=600,
                openlist_task_id="known-upstream" if index == 0 else None,
            )
            db.add(task)
            db.flush()
            item = db.get(MagnetSubmissionItem, (started["submission_id"], index))
            item.status, item.download_task_id, item.run_token = "running", task.task_id, str(uuid.uuid4())
        db.commit()
        recover_jobs(db)
    assert runner.submit_once()
    assert not runner.submit_once()
    assert calls == [magnet(2)]
    result = jobs.client.get(f"/api/v1/magnets/submissions/{started['submission_id']}", headers=jobs.headers[0]).json()[
        "data"
    ]
    assert [item["status"] for item in result["items"]] == ["submitted", "unknown", "failed"]


def test_ownership_input_limits_and_creation_conflicts(jobs):
    job, body = create_job(jobs)
    path = f"/api/v1/magnets/parse-jobs/{job['job_id']}"
    assert jobs.client.get(path).status_code == 401
    for endpoint in (path, path + "/items/0"):
        assert jobs.client.get(endpoint, headers=jobs.headers[1]).status_code == 404
    assert jobs.client.post(path + "/cancel", headers=jobs.headers[1]).status_code == 404
    assert jobs.client.post(path + "/resume", json={}, headers=jobs.headers[1]).status_code == 404
    assert jobs.client.get("/api/v1/magnets/parse-jobs", headers=jobs.headers[1]).json()["data"]["items"] == []
    assert (
        jobs.client.get(
            "/api/v1/magnets/parse-jobs", params={"request_id": body["request_id"]}, headers=jobs.headers[0]
        ).json()["data"]["total"]
        == 1
    )
    changed = {**body, "magnet_links": [magnet(8)]}
    assert jobs.client.post("/api/v1/magnets/parse-jobs", json=changed, headers=jobs.headers[0]).status_code == 409
    assert (
        jobs.client.post(
            "/api/v1/magnets/parse-jobs", json={**body, "request_id": str(uuid.uuid4())}, headers=jobs.headers[0]
        ).status_code
        == 409
    )
    for links in ([], [magnet(0)] * 101, ["invalid"], [magnet(0) + "x" * 8192]):
        response = jobs.client.post(
            "/api/v1/magnets/parse-jobs", json={**body, "magnet_links": links}, headers=jobs.headers[0]
        )
        assert response.status_code == 422
    for indices in ([-1], [100], [True], [0, 0]):
        response = jobs.client.post(
            path + "/submissions",
            json={"request_id": str(uuid.uuid4()), "item_indices": indices},
            headers=jobs.headers[0],
        )
        assert response.status_code == 422


def test_manual_code_overrides_identity_and_survives_retry(jobs):
    """手工番号立即生效并重算查重，重试时不被元数据结果顶回。"""
    runner = jobs.runner()
    runner.start()
    job, _ = create_job(jobs, 1)
    job_id = job["job_id"]
    wait_until(lambda: get_job(jobs, job_id)["completed"] == 1)
    path = f"/api/v1/magnets/parse-jobs/{job_id}/items/0"
    assert get_job(jobs, job_id)["items"][0]["summary"]["verified_code"] == "ABC-100"

    changed = jobs.client.patch(path, json={"code": "300MIUM-777"}, headers=jobs.headers[0])
    assert changed.status_code == 200, changed.text
    summary = changed.json()["data"]["summary"]
    assert summary["verified_code"] == "300MIUM-777"
    assert summary["variant"] == "original"
    assert get_job(jobs, job_id)["items"][0]["manual_code"] == "300MIUM-777"

    # 空串表示放弃识别；提交时不得回退到 dn 或文件名。
    blank = jobs.client.patch(path, json={"code": "  "}, headers=jobs.headers[0])
    assert blank.status_code == 200, blank.text
    assert blank.json()["data"]["summary"]["verified_code"] is None
    assert get_job(jobs, job_id)["items"][0]["manual_code"] == ""

    # null 回退自动识别，dn 结果重新生效。
    restored = jobs.client.patch(path, json={"code": None}, headers=jobs.headers[0])
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"]["summary"]["verified_code"] == "ABC-100"
    assert get_job(jobs, job_id)["items"][0]["manual_code"] is None

    # 重试该条目后手动结论保持一致，且不额外请求元数据服务去猜测番号。
    retry = jobs.client.patch(path, json={"code": "300MIUM-777"}, headers=jobs.headers[0])
    assert retry.status_code == 200, retry.text
    jobs.metadata.calls.clear()
    assert jobs.client.post(f"/api/v1/magnets/parse-jobs/{job_id}/resume", json={"indices": [0]}, headers=jobs.headers[0]).status_code == 400
    wait_until(lambda: get_job(jobs, job_id)["items"][0]["status"] == "completed")


def test_manual_code_rejects_invalid_input_and_unfinished_items(jobs):
    jobs.metadata.gates = {0: threading.Event()}
    runner = jobs.runner()
    runner.start()
    job, _ = create_job(jobs, 1)
    job_id = job["job_id"]
    path = f"/api/v1/magnets/parse-jobs/{job_id}/items/0"
    wait_until(lambda: jobs.metadata.active == 1)
    # 解析进行中不允许改动，避免结果回写覆盖用户输入。
    assert jobs.client.patch(path, json={"code": "ABC-123"}, headers=jobs.headers[0]).status_code == 409
    jobs.metadata.gates[0].set()
    wait_until(lambda: get_job(jobs, job_id)["completed"] == 1)
    assert jobs.client.patch(path, json={"code": "x" * 65}, headers=jobs.headers[0]).status_code == 422
    assert jobs.client.patch(path, json={"code": "ab\x00c"}, headers=jobs.headers[0]).status_code == 422
    assert jobs.client.patch(path, json={"code": "300MIUM-777"}, headers=jobs.headers[1]).status_code == 404


def test_overloaded_metadata_is_retried_with_backoff_then_succeeds(jobs):
    """503 过载先退避重试，不把整条磁力直接判失败。"""
    attempts = Counter()

    class Flaky:
        def factory(self, *_args):
            owner = self

            class Parser:
                def __enter__(self):
                    return self

                def __exit__(self, *_):
                    pass

                def parse_with_retry(self, uri, **_kwargs):
                    attempts[int(magnet_info_hash(uri), 16) - 1] += 1
                    if attempts[0] == 1:
                        raise MagnetMetadataError("过载", reason="bt_metadata_overloaded", retry_after=0.01)
                    return {
                        "info_hash": magnet_info_hash(uri),
                        "name": "ABC-100",
                        "size": 600,
                        "files": [{"name": "ABC-100.mkv", "size": 600}],
                        "metadata_fallback": False,
                    }

            return Parser()

    runner = jobs.runner(parser_factory=Flaky().factory, retry_attempts=3)
    runner.start()
    job, _ = create_job(jobs, 1)
    job_id = job["job_id"]
    wait_until(lambda: get_job(jobs, job_id)["status"] == "completed", timeout=15)
    assert attempts[0] >= 2
    assert get_job(jobs, job_id)["confirmed"] == 1
