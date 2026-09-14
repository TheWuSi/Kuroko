from fastapi import APIRouter

from app.api.v1 import auth as auth_module
from app.api.v1 import codes as codes_module
from app.api.v1 import config as config_module
from app.api.v1 import magnet_jobs as magnet_jobs_module
from app.api.v1 import magnets as magnets_module
from app.api.v1 import storages as storages_module
from app.api.v1 import tasks as tasks_module

router = APIRouter(prefix="/api/v1")
router.include_router(auth_module.router)
router.include_router(config_module.router)
router.include_router(storages_module.router)
router.include_router(magnets_module.router)
router.include_router(magnet_jobs_module.router)
router.include_router(tasks_module.router)
router.include_router(codes_module.router)
