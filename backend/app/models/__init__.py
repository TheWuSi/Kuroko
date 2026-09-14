from app.models.code import CodeRecord, DuplicateAllowance
from app.models.config import ScanJob, SystemConfig
from app.models.magnet_job import MagnetParseItem, MagnetParseJob, MagnetSubmission, MagnetSubmissionItem
from app.models.storage import StorageGroup, StorageGroupPath, StorageIgnore, StorageSpaceOverride
from app.models.task import DownloadTask, TaskStatus
from app.models.user import User

__all__ = [
    "CodeRecord",
    "DownloadTask",
    "DuplicateAllowance",
    "MagnetParseItem",
    "MagnetParseJob",
    "MagnetSubmission",
    "MagnetSubmissionItem",
    "ScanJob",
    "StorageGroup",
    "StorageGroupPath",
    "StorageIgnore",
    "StorageSpaceOverride",
    "SystemConfig",
    "TaskStatus",
    "User",
]
