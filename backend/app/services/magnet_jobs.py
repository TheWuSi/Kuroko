"""长耗时磁力任务：数据库是进度真相，页面连接和 JWT 不参与执行生命周期。"""

import hashlib
import inspect
import json
import logging
import os
import threading
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session, defer

from app.core.database import SessionLocal
from app.models.magnet_job import MagnetParseItem, MagnetParseJob, MagnetSubmission, MagnetSubmissionItem
from app.models.task import DownloadTask
from app.schemas.magnet import ParseJobRequest, SubmissionRequest
from app.services.config_service import get_config
from app.services.download_service import submit_batch
from app.services.library_service import duplicate_decision, find_group
from app.services.magnet_metadata_client import (
    MAX_RETRY_ATTEMPTS,
    MetadataQueueFull,
    MagnetMetadataApiClient,
    backoff_delay,
    parse_slot,
)
from app.services.magnet_service import build_parse_result, public_result, resolve_identity, summarize
from app.utils.magnet_parser import clean_magnet, magnet_info_hash

ACTIVE = {"pending", "running"}
# 解析线程数可配置：元数据服务容量有限，默认 4 与全局并发上限共同构成保护。
DEFAULT_PARSE_WORKERS = 4
MAX_PARSE_WORKERS = 16
DEFAULT_RETRY_ATTEMPTS = 3
job_lock = threading.RLock()
logger = logging.getLogger(__name__)


def parse_workers() -> int:
    try:
        value = int(os.getenv("KUROKO_PARSE_WORKERS", str(DEFAULT_PARSE_WORKERS)))
    except ValueError:
        return DEFAULT_PARSE_WORKERS
    return max(1, min(value, MAX_PARSE_WORKERS))


class JobConflictError(ValueError):
    pass


def now() -> datetime:
    return datetime.now(UTC)


def iso(value: datetime | None) -> str | None:
    return value.replace(tzinfo=UTC).isoformat() if value else None


def fingerprint(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def parse_items(db: Session, job_id: str):
    return (
        db.query(MagnetParseItem)
        .options(defer(MagnetParseItem.result))
        .filter_by(job_id=job_id)
        .order_by(MagnetParseItem.index)
    )


def finish_parse(db: Session, job: MagnetParseJob) -> None:
    db.flush()
    states = Counter(status for (status,) in db.query(MagnetParseItem.status).filter_by(job_id=job.job_id))
    # 退避等待中的条目仍是 pending，批次因此保持"解析中"，符合用户对未完成项的预期。
    if not states["running"] and (job.cancel_requested or not states["pending"]):
        job.status = "cancelled" if job.cancel_requested else "completed"
        job.finished_at = now()
    job.updated_at = now()
    job.revision += 1


def finish_submission(db: Session, submission: MagnetSubmission) -> None:
    db.flush()
    active = (
        db.query(MagnetSubmissionItem)
        .filter(
            MagnetSubmissionItem.submission_id == submission.submission_id,
            MagnetSubmissionItem.status.in_(ACTIVE),
        )
        .first()
    )
    if active is None:
        submission.status = "completed"
        submission.finished_at = now()
    submission.updated_at = now()


def create_parse_job(db: Session, user_id: int, payload: ParseJobRequest) -> MagnetParseJob:
    request_id = str(payload.request_id)
    signature = fingerprint(payload.model_dump(mode="json"))
    with job_lock:
        previous = db.query(MagnetParseJob).filter_by(user_id=user_id, request_id=request_id).first()
        if previous:
            if previous.fingerprint != signature:
                raise JobConflictError("请求编号已用于另一批输入，请重新开始解析")
            return previous
        if (
            db.query(MagnetParseJob)
            .filter(MagnetParseJob.user_id == user_id, MagnetParseJob.status.in_(ACTIVE))
            .first()
        ):
            raise JobConflictError("已有解析批次正在运行，请查看进度或先停止该批次")
        scope = payload.model_dump(exclude={"magnet_links", "request_id"}, exclude_none=True)
        job = MagnetParseJob(
            user_id=user_id,
            request_id=request_id,
            fingerprint=signature,
            scope=scope,
            filter_config=get_config(db, masked=False)["filter"],
            created_at=now(),
            updated_at=now(),
        )
        db.add(job)
        db.flush()
        for index, magnet in enumerate(payload.magnet_links):
            db.add(MagnetParseItem(job_id=job.job_id, index=index, magnet=magnet, info_hash=magnet_info_hash(magnet)))
        db.commit()
        return job


def cancel_parse(db: Session, job: MagnetParseJob) -> None:
    with job_lock:
        db.refresh(job)
        if job.status not in ACTIVE:
            return
        job.cancel_requested = True
        finish_parse(db, job)
        db.commit()


def resume_parse(
    db: Session, job: MagnetParseJob, indices: list[int] | None, *, keep_duplicates: bool = False
) -> None:
    with job_lock:
        db.refresh(job)
        if job.status in ACTIVE:
            raise JobConflictError("该批次仍在解析或正在停止，请等待当前请求结束")
        if (
            db.query(MagnetParseJob)
            .filter(MagnetParseJob.user_id == job.user_id, MagnetParseJob.status.in_(ACTIVE))
            .first()
        ):
            raise JobConflictError("已有其他解析批次正在运行")
        if (
            db.query(MagnetSubmission)
            .filter(MagnetSubmission.job_id == job.job_id, MagnetSubmission.status.in_(ACTIVE))
            .first()
        ):
            raise JobConflictError("该批次正在提交下载，请等待提交结束")
        items = parse_items(db, job.job_id).all()
        eligible = {item.index for item in items if item.status in {"pending", "failed", "fallback"}}
        selected = set(indices) if indices is not None else eligible
        if not selected or not selected.issubset(eligible):
            raise ValueError("仅可继续未完成、失败或名称初筛的条目")
        for item in items:
            if item.index in selected:
                item.status, item.run_token, item.error_message = "pending", None, None
                # 手工重试清空退避截止时刻，让条目立刻重新进入队列。
                item.next_attempt_at = None
                if item.manual_code is None:
                    item.attempt += 1
                item.started_at = item.finished_at = None
        job.status, job.cancel_requested, job.finished_at = "pending", False, None
        if not keep_duplicates:
            # 默认不保留已存在的重复项：批次确认完成后其输入即可移除，只剩仍需处理的条目。
            job.scope = {**job.scope, "prune_duplicates": True}
        job.updated_at = now()
        job.revision += 1
        db.commit()


def correct_parse_item(db: Session, job: MagnetParseJob, index: int, manual_code: str | None) -> MagnetParseItem:
    """按用户输入覆盖番号并重算版本、分集与查重；不重新请求元数据服务。

    manual_code 为 None 表示回退到自动识别结果，空串表示放弃识别（提交时记为 UNKNOWN）。
    """
    with job_lock:
        db.refresh(job)
        item = db.get(MagnetParseItem, (job.job_id, index))
        if item is None:
            raise ValueError("解析条目不存在")
        if item.status in {"pending", "running"}:
            raise JobConflictError("该条目正在解析，请等待本轮结束或先停止批次")
        if not item.result:
            raise ValueError("该条目尚无解析结果，无法修改番号")
        if item.status == "failed":
            raise ValueError("该条目解析失败，请先重试解析再修改番号")
        # 修正时沿用条目所在批次的过滤配置，保证分集重算与解析阶段一致。
        # result 原样回传，其中保留的 auto_code 供用户清除手工番号时恢复自动结论。
        result = resolve_identity({**dict(item.result), "_config": {"filter": job.filter_config}}, manual_code)
        result.update(
            duplicate_decision(
                db,
                result["verified_code"] or "UNKNOWN",
                result["variant"],
                part_numbers=result["part_numbers"],
                target_group=job.scope.get("target_group"),
                target_path=job.scope.get("target_path"),
            )
        )
        stored = public_result(result)
        item.manual_code = None if manual_code is None else manual_code.strip()
        item.result = stored
        item.summary = summarize(stored)
        job.updated_at = now()
        job.revision += 1
        db.commit()
        return item


def create_submission(db: Session, job: MagnetParseJob, payload: SubmissionRequest) -> MagnetSubmission:
    signature = fingerprint({"job_id": job.job_id, **payload.model_dump(mode="json")})
    with job_lock:
        previous = db.query(MagnetSubmission).filter_by(user_id=job.user_id, request_id=str(payload.request_id)).first()
        if previous:
            if previous.fingerprint != signature:
                raise JobConflictError("请求编号已用于另一项提交")
            return previous
        db.refresh(job)
        if job.status in ACTIVE:
            raise JobConflictError("请等待解析完成，或停止解析后提交已完成项")
        scope = payload.model_dump(include={"target_path", "target_group"}, exclude_none=True)
        if not scope:
            raise ValueError("请先选择下载目录或分组")
        if scope.get("target_group") is not None:
            scope["target_group"] = find_group(db, scope["target_group"]).id
        target_key = json.dumps(scope, sort_keys=True)
        items = {item.index: item for item in parse_items(db, job.job_id)}
        selected = [items.get(index) for index in payload.item_indices]
        if any(item is None or item.status not in {"completed", "fallback"} or not item.summary for item in selected):
            raise ValueError("所选条目不存在或尚未完成解析")
        for item in selected:
            blocking = (
                db.query(MagnetSubmissionItem, MagnetSubmission)
                .join(MagnetSubmission)
                .filter(
                    MagnetSubmission.user_id == job.user_id,
                    MagnetSubmission.target_key == target_key,
                    MagnetSubmissionItem.info_hash == item.info_hash,
                    MagnetSubmissionItem.status.in_(["pending", "running", "unknown", "submitted", "skipped"]),
                )
                .all()
            )
            for prior, parent in blocking:
                if prior.status in {"pending", "running", "unknown"}:
                    raise JobConflictError(f"第 {item.index + 1} 条已有提交正在处理或等待核实，请勿重复提交")
                if parent.job_id == job.job_id and (
                    prior.status == "submitted" or (prior.result or {}).get("reason") == "already_submitted"
                ):
                    raise JobConflictError(f"第 {item.index + 1} 条已提交，请在任务页查看进度")
        submission = MagnetSubmission(
            user_id=job.user_id,
            job_id=job.job_id,
            request_id=str(payload.request_id),
            fingerprint=signature,
            scope=scope,
            target_key=target_key,
            force=payload.force,
            created_at=now(),
            updated_at=now(),
        )
        db.add(submission)
        db.flush()
        for item in selected:
            summary = item.summary
            db.add(
                MagnetSubmissionItem(
                    submission_id=submission.submission_id,
                    index=item.index,
                    info_hash=item.info_hash,
                    payload={
                        "magnet": clean_magnet(item.magnet),
                        # 手动清空番号后不回退到 dn，只有未指定过修正的条目才使用自动识别结果。
                        "code": "UNKNOWN" if item.manual_code == "" else (
                            summary.get("verified_code") or summary.get("dn_code") or "UNKNOWN"
                        ),
                        "variant": summary["variant"],
                        "force": payload.force,
                        **scope,
                    },
                )
            )
        db.commit()
        return submission


def serialize_job(db: Session, job: MagnetParseJob, *, detail: bool = True) -> dict:
    items = parse_items(db, job.job_id).all()
    counts = Counter(item.status for item in items)
    data = {
        "job_id": job.job_id,
        "request_id": job.request_id,
        "scope": job.scope,
        "status": job.status,
        "cancel_requested": job.cancel_requested,
        "revision": job.revision,
        "total": len(items),
        "completed": sum(counts[state] for state in ("completed", "fallback", "failed")),
        "confirmed": counts["completed"],
        "fallback": counts["fallback"],
        "failed": counts["failed"],
        "created_at": iso(job.created_at),
        "updated_at": iso(job.updated_at),
        "finished_at": iso(job.finished_at),
    }
    if detail:
        data["items"] = [
            {
                "index": item.index,
                "magnet": item.magnet,
                "status": item.status,
                "attempt": item.attempt,
                "summary": item.summary,
                "error_message": item.error_message,
                "manual_code": item.manual_code,
                # 退避等待中的条目告知前端预计重试时刻，避免误判为卡住。
                "retry_at": iso(item.next_attempt_at),
                "started_at": iso(item.started_at),
                "finished_at": iso(item.finished_at),
            }
            for item in items
        ]
        latest = {}
        rows = (
            db.query(MagnetSubmissionItem, MagnetSubmission)
            .join(MagnetSubmission)
            .filter(
                MagnetSubmission.job_id == job.job_id,
            )
            .order_by(MagnetSubmission.created_at, MagnetSubmission.submission_id)
        )
        for item, submission in rows:
            latest[(item.index, submission.target_key)] = {
                "index": item.index,
                "status": item.status,
                "result": item.result,
                "submission_id": submission.submission_id,
                "scope": submission.scope,
                "task_id": item.download_task_id,
            }
        data["outcomes"] = list(latest.values())
    return data


def serialize_submission(db: Session, submission: MagnetSubmission, *, detail: bool = True) -> dict:
    items = (
        db.query(MagnetSubmissionItem)
        .filter_by(submission_id=submission.submission_id)
        .order_by(MagnetSubmissionItem.index)
        .all()
    )
    counts = Counter(item.status for item in items)
    data = {
        "submission_id": submission.submission_id,
        "request_id": submission.request_id,
        "job_id": submission.job_id,
        "status": submission.status,
        "scope": submission.scope,
        "force": submission.force,
        "total": len(items),
        "completed": sum(counts[state] for state in ("submitted", "skipped", "failed", "unknown")),
        "submitted": counts["submitted"],
        "skipped": counts["skipped"],
        "failed": counts["failed"],
        "unknown": counts["unknown"],
        "created_at": iso(submission.created_at),
        "updated_at": iso(submission.updated_at),
        "finished_at": iso(submission.finished_at),
    }
    if detail:
        data["input_links"] = [
            magnet
            for (magnet,) in db.query(MagnetParseItem.magnet)
            .filter_by(job_id=submission.job_id)
            .order_by(MagnetParseItem.index)
        ]
        data["items"] = [
            {
                "index": item.index,
                "magnet": item.payload["magnet"],
                "status": item.status,
                "task_id": item.download_task_id,
                "result": item.result,
            }
            for item in items
        ]
    return data


def uncertain_result(item: MagnetSubmissionItem) -> dict:
    return {
        "index": item.index,
        "magnet": item.payload["magnet"],
        "code": item.payload["code"],
        "task_id": item.download_task_id,
        "reason": "submission_unknown",
        "message": "提交结果待核实，请先到任务页和 OpenList 核实，勿重复提交",
    }


def recover_submission_item(db: Session, item: MagnetSubmissionItem) -> None:
    task = db.query(DownloadTask).filter_by(task_id=item.download_task_id).first() if item.download_task_id else None
    if task and task.openlist_task_id:
        item.status = "submitted"
        item.result = {
            "index": item.index,
            "magnet": item.payload["magnet"],
            "code": task.code,
            "task_id": task.task_id,
            "target_path": task.target_path,
            "openlist_task_id": task.openlist_task_id,
            "total_size": task.total_size,
            "metadata_fallback": task.total_size == 0,
        }
    elif task and task.status == "failed":
        item.status = "failed"
        item.result = {
            **uncertain_result(item),
            "reason": "upstream_error",
            "message": task.error_message or "提交失败",
        }
    else:
        item.status, item.result = "unknown", uncertain_result(item)
    item.run_token = None


def recover_jobs(db: Session) -> None:
    with job_lock:
        for item in db.query(MagnetParseItem).filter_by(status="running"):
            item.status, item.run_token, item.started_at = "pending", None, None
            item.attempt += 1
        for job in db.query(MagnetParseJob).filter(MagnetParseJob.status.in_(ACTIVE)):
            finish_parse(db, job)
        # 元数据读取可安全继续；已经开始的提交必须先通过本地凭据核实。
        for item in db.query(MagnetSubmissionItem).filter_by(status="running"):
            recover_submission_item(db, item)
        for submission in db.query(MagnetSubmission).filter(MagnetSubmission.status.in_(ACTIVE)):
            finish_submission(db, submission)
        db.commit()


class MagnetJobRunner:
    """固定数量后台线程；每次领取及保存使用短事务，网络等待不占解析事务。"""

    def __init__(
        self,
        sessions=SessionLocal,
        *,
        parser_factory=MagnetMetadataApiClient,
        submitter=submit_batch,
        retry_attempts: int = DEFAULT_RETRY_ATTEMPTS,
        parse_slots: threading.BoundedSemaphore | None = None,
        workers: int | None = None,
    ):
        self.sessions = sessions
        self.parser_factory = parser_factory
        self.submitter = submitter
        # 单条目最大尝试次数：默认 3 次使 429/5xx/超时可在批次内自愈。
        self.retry_attempts = max(1, min(retry_attempts, MAX_RETRY_ATTEMPTS))
        # 不传时使用进程级共享名额，保证多个 runner 也受同一上限保护。
        self.parse_slots = parse_slots if parse_slots is not None else parse_slot()
        self.workers = max(1, min(workers, MAX_PARSE_WORKERS)) if workers else parse_workers()
        self.stop_event = threading.Event()
        self.run_token = str(uuid.uuid4())
        self.threads: list[threading.Thread] = []

    def start(self) -> None:
        with self.sessions() as db:
            recover_jobs(db)
        # 提交仍由单线程串行执行，避免并发向 OpenList 投递导致重复任务。
        kinds = ["parse"] * self.workers + ["submit"]
        for kind in kinds:
            thread = threading.Thread(target=self._loop, args=(kind,), name=f"magnet-{kind}", daemon=True)
            self.threads.append(thread)
            thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        # 未返回的上游调用可在有限单次超时内收尾；退出进程不会等待整批解析。
        for thread in self.threads:
            thread.join(timeout=0.2)

    def _loop(self, kind: str) -> None:
        while not self.stop_event.is_set():
            try:
                worked = self.parse_once() if kind == "parse" else self.submit_once()
            except Exception as exc:
                logger.warning("磁力后台任务暂时无法推进：%s", type(exc).__name__)
                self.stop_event.wait(1)
                continue
            if not worked:
                self.stop_event.wait(0.25)

    def parse_once(self) -> bool:
        with job_lock, self.sessions() as db:
            row = (
                db.query(MagnetParseItem, MagnetParseJob)
                .join(MagnetParseJob)
                .filter(
                    MagnetParseItem.status == "pending",
                    MagnetParseJob.status.in_(ACTIVE),
                    MagnetParseJob.cancel_requested.is_(False),
                    # 尚未到期的条目让给其他条目，避免整批同时重试再次压垮元数据服务。
                    or_(
                        MagnetParseItem.next_attempt_at.is_(None),
                        MagnetParseItem.next_attempt_at <= now(),
                    ),
                )
                .order_by(MagnetParseJob.created_at, MagnetParseItem.index)
                .first()
            )
            if row is None or self.stop_event.is_set():
                return False
            item, job = row
            config = get_config(db, masked=False)
            config["filter"] = job.filter_config
            item.status, item.run_token, item.started_at = "running", self.run_token, now()
            item.next_attempt_at = None
            job.status, job.updated_at = "running", now()
            job.revision += 1
            job_id, index, attempt, magnet = job.job_id, item.index, item.attempt, item.magnet
            manual_code = item.manual_code
            db.commit()
        result, error, retry_delay = None, None, None
        try:
            bt = config["bt_parser"]
            with self.parser_factory(bt["service_url"], bt["token"], bt["timeout_seconds"]) as parser:
                # 兼容只实现 parse_with_fallback(uri) 的解析器；重试与并发名额由元数据客户端自行提供。
                options = {"attempts": self.retry_attempts, "stop_event": self.stop_event, "slot": self.parse_slots}
                fetcher = getattr(parser, "parse_with_retry", None)
                if fetcher is not None:
                    parsed = fetcher(clean_magnet(magnet), **options)
                else:
                    signature = inspect.signature(parser.parse_with_fallback)
                    if all(name in signature.parameters for name in ("attempts", "stop_event", "slot")):
                        parsed = parser.parse_with_fallback(clean_magnet(magnet), **options)
                    else:
                        parsed = parser.parse_with_fallback(clean_magnet(magnet))
            result = public_result(build_parse_result(magnet, parsed, config))
            if manual_code is not None:
                # 手工指定过番号的条目重试时保留用户结论，只更新文件与大小等元数据。
                result = public_result(resolve_identity({**result, "_config": config}, manual_code))
        except MetadataQueueFull:
            # 本地并发已满：条目回到队列，不计入失败也不消耗重试次数。
            with job_lock, self.sessions() as db:
                item = db.get(MagnetParseItem, (job_id, index))
                if item is not None and item.run_token == self.run_token and item.status == "running":
                    item.status, item.run_token = "pending", None
                    item.next_attempt_at = now() + timedelta(seconds=1)
                    db.commit()
            return False
        except Exception as exc:
            reason = getattr(exc, "reason", "bt_metadata_unavailable")
            retryable = reason in {"bt_metadata_timeout", "bt_metadata_overloaded", "bt_metadata_connection_error"}
            if retryable and attempt < self.retry_attempts and not self.stop_event.is_set():
                retry_delay = backoff_delay(attempt, getattr(exc, "retry_after", None))
                logger.warning("磁力元数据服务暂不可用，%s 秒后重试第 %s 条：%s", round(retry_delay, 1), index + 1, reason)
            else:
                logger.warning("磁力条目解析未完成：%s", type(exc).__name__)
                error = "解析失败，请检查元数据服务配置后重试"
        with job_lock, self.sessions() as db:
            item = db.get(MagnetParseItem, (job_id, index))
            if item is None or item.run_token != self.run_token or item.status != "running":
                return True
            job_row = db.get(MagnetParseJob, job_id)
            if retry_delay is not None:
                # 重新排队等待下一轮，递增尝试次数以便最终收敛到失败。
                item.status, item.run_token, item.started_at = "pending", None, None
                item.attempt += 1
                item.next_attempt_at = now() + timedelta(seconds=retry_delay)
                job_row.updated_at = now()
                job_row.revision += 1
                db.commit()
                return True
            item.result = result
            item.summary = summarize(result) if result else None
            item.status = "failed" if error else "fallback" if result["metadata_fallback"] else "completed"
            item.error_message, item.finished_at, item.run_token = error, now(), None
            finish_parse(db, job_row)
            db.commit()
        return True

    def submit_once(self) -> bool:
        with job_lock, self.sessions() as db:
            row = (
                db.query(MagnetSubmissionItem, MagnetSubmission)
                .join(MagnetSubmission)
                .filter(
                    MagnetSubmissionItem.status == "pending",
                    MagnetSubmission.status.in_(ACTIVE),
                )
                .order_by(MagnetSubmission.created_at, MagnetSubmissionItem.index)
                .first()
            )
            if row is None or self.stop_event.is_set():
                return False
            item, submission = row
            item.status, item.run_token = "running", self.run_token
            submission.status, submission.updated_at = "running", now()
            submission_id, index, payload = submission.submission_id, item.index, item.payload
            db.commit()
        result, result_state = None, None
        try:
            with self.sessions() as db:

                def link_task(task: DownloadTask) -> None:
                    linked = db.get(MagnetSubmissionItem, (submission_id, index))
                    if linked.status != "running" or linked.run_token != self.run_token:
                        raise ValueError("该提交已中断，请先核实任务状态")
                    linked.download_task_id = task.task_id

                response = self.submitter(db, [payload], on_task_created=link_task)
                for state, key in (("submitted", "submitted"), ("skipped", "skipped"), ("failed", "failed")):
                    if response[key]:
                        result = {**response[key][0], "index": index}
                        result_state = "unknown" if result.get("reason") == "submission_unknown" else state
                        break
                if result is None:
                    raise ValueError("提交服务未返回逐条结果")
        except Exception as exc:
            logger.warning("磁力提交需要核实：%s", type(exc).__name__)
        with job_lock, self.sessions() as db:
            item = db.get(MagnetSubmissionItem, (submission_id, index))
            if item is None or item.status != "running" or item.run_token != self.run_token:
                return True
            if result is None:
                recover_submission_item(db, item)
            else:
                item.status, item.result, item.run_token = result_state, result, None
                item.download_task_id = result.get("task_id") or item.download_task_id
            finish_submission(db, db.get(MagnetSubmission, submission_id))
            db.commit()
        return True
