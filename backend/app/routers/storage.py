from fastapi import APIRouter
from pydantic import BaseModel

from app.services import library_service
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


class DeleteOrphansRequest(BaseModel):
    names: list[str]


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
