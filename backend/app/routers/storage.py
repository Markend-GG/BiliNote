from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import cleanup_service, library_service
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


class DeleteOrphansRequest(BaseModel):
    names: list[str]


class CleanupPolicyRequest(BaseModel):
    enabled: Optional[bool] = None
    keep_days: Optional[int] = None
    max_orphan_mb: Optional[int] = None


@router.get("/storage/scan")
def scan_storage():
    """设置页「存储」的数据源：截图占用/孤儿清单/笔记与向量库体积。"""
    try:
        return R.success(data=library_service.scan_storage())
    except Exception as e:
        logger.error(f"存储扫描失败: {e}", exc_info=True)
        return R.error(msg=f"存储扫描失败: {e}")


@router.post("/storage/delete")
def delete_orphans(data: DeleteOrphansRequest):
    """删除孤儿截图。服务端删除前会重算引用集，被任何笔记引用的都会跳过。"""
    try:
        return R.success(data=library_service.delete_orphan_screenshots(data.names))
    except Exception as e:
        logger.error(f"删除孤儿截图失败: {e}", exc_info=True)
        return R.error(msg=f"删除失败: {e}")


@router.get("/storage/cleanup_policy")
def get_cleanup_policy():
    """自动清理的策略与上次执行结果。"""
    try:
        return R.success(data=cleanup_service.get_status())
    except Exception as e:
        logger.error(f"读取自动清理配置失败: {e}", exc_info=True)
        return R.error(msg=f"读取配置失败: {e}")


@router.post("/storage/cleanup_policy")
def update_cleanup_policy(data: CleanupPolicyRequest):
    """改策略。keep_days / max_orphan_mb 填 0 = 关掉对应那条规则。"""
    try:
        patch = {k: v for k, v in data.model_dump().items() if v is not None}
        return R.success(data=cleanup_service.save_policy(patch), msg="已保存")
    except Exception as e:
        logger.error(f"保存自动清理配置失败: {e}", exc_info=True)
        return R.error(msg=f"保存失败: {e}")


@router.post("/storage/cleanup_run")
def run_cleanup_now():
    """立刻跑一次自动清理（界面上的按钮）。手动触发不受"启用"开关限制。"""
    try:
        return R.success(data=cleanup_service.run_auto_cleanup("manual"))
    except Exception as e:
        logger.error(f"自动清理失败: {e}", exc_info=True)
        return R.error(msg=f"清理失败: {e}")
