from typing import Optional

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from app.db import library_dao
from app.services.library_service import delete_note_artifacts
from app.utils.logger import get_logger
from app.utils.response import ResponseWrapper as R

logger = get_logger(__name__)

router = APIRouter()


class FolderCreate(BaseModel):
    name: str


class FolderRename(BaseModel):
    name: str


class MoveRequest(BaseModel):
    task_id: str
    folder_id: Optional[str] = None


class RenameRequest(BaseModel):
    task_id: str
    title: str


class TouchRequest(BaseModel):
    task_id: str


class VersionItem(BaseModel):
    ver_id: str
    content: str
    style: Optional[str] = None
    model_name: Optional[str] = None
    # epoch 毫秒；前端存量版本是 ISO 串，上传前自行转换
    created_at: Optional[int] = None


class VersionsSyncRequest(BaseModel):
    task_id: str
    versions: list[VersionItem]


@router.get("/library")
def get_library():
    """书架页的唯一数据源：文件夹 + 全部笔记索引。"""
    try:
        notes = library_dao.list_notes()
        folders = library_dao.list_folders()
        counts: dict[str, int] = {}
        for note in notes:
            key = note["folder_id"] or ""
            counts[key] = counts.get(key, 0) + 1
        for folder in folders:
            folder["note_count"] = counts.get(folder["id"], 0)
        return R.success(data={"folders": folders, "notes": notes})
    except Exception as e:
        logger.error(f"读取笔记库失败: {e}", exc_info=True)
        return R.error(msg=f"读取笔记库失败: {e}")


@router.post("/library/folder")
def create_folder(data: FolderCreate):
    try:
        return R.success(data=library_dao.create_folder(data.name))
    except ValueError as e:
        return R.error(msg=str(e))
    except Exception as e:
        logger.error(f"创建文件夹失败: {e}", exc_info=True)
        return R.error(msg=f"创建文件夹失败: {e}")


@router.patch("/library/folder/{folder_id}")
def rename_folder(folder_id: str, data: FolderRename):
    try:
        folder = library_dao.rename_folder(folder_id, data.name)
        if folder is None:
            return R.error(msg="文件夹不存在")
        return R.success(data=folder)
    except ValueError as e:
        return R.error(msg=str(e))
    except Exception as e:
        logger.error(f"重命名文件夹失败: {e}", exc_info=True)
        return R.error(msg=f"重命名失败: {e}")


@router.delete("/library/folder/{folder_id}")
def delete_folder(folder_id: str, background_tasks: BackgroundTasks, mode: str = "move"):
    """mode=move 把里面的笔记归入未分类；mode=delete 连笔记一起删。"""
    if mode not in ("move", "delete"):
        return R.error(msg="mode 只能是 move 或 delete")
    try:
        affected = library_dao.delete_folder(folder_id, mode)
        if affected:
            # 索引行已经删掉了，书架立刻看不到这些笔记；磁盘/截图/向量索引的清理放后台，
            # 几十篇一起删时不该让请求卡在这里
            for task_id in affected:
                background_tasks.add_task(delete_note_artifacts, task_id)
        return R.success(data={"deleted_notes": len(affected)})
    except Exception as e:
        logger.error(f"删除文件夹失败: {e}", exc_info=True)
        return R.error(msg=f"删除文件夹失败: {e}")


@router.post("/library/move")
def move_note(data: MoveRequest):
    try:
        if not library_dao.move_note(data.task_id, data.folder_id):
            return R.error(msg="笔记不存在")
        return R.success(data={"task_id": data.task_id, "folder_id": data.folder_id})
    except ValueError as e:
        return R.error(msg=str(e))
    except Exception as e:
        logger.error(f"移动笔记失败: {e}", exc_info=True)
        return R.error(msg=f"移动失败: {e}")


@router.post("/library/rename")
def rename_note(data: RenameRequest):
    try:
        if not library_dao.rename_note(data.task_id, data.title):
            return R.error(msg="笔记不存在")
        return R.success(data={"task_id": data.task_id, "title": data.title.strip() or None})
    except Exception as e:
        logger.error(f"重命名笔记失败: {e}", exc_info=True)
        return R.error(msg=f"重命名失败: {e}")


@router.get("/library/versions/{task_id}")
def get_versions(task_id: str):
    """版本历史（新在前）。后端是权威存储，浏览器那份只是缓存。"""
    try:
        return R.success(data=library_dao.list_versions(task_id))
    except Exception as e:
        logger.error(f"读取版本历史失败 {task_id}: {e}", exc_info=True)
        return R.error(msg=f"读取版本历史失败: {e}")


@router.post("/library/versions/sync")
def sync_versions(data: VersionsSyncRequest):
    """浏览器存量版本一次性上传（升级到本版后首次打开自动跑），按 ver_id 去重、只补缺的。"""
    try:
        added = library_dao.sync_versions(
            data.task_id,
            [
                {
                    "ver_id": item.ver_id,
                    "content": item.content,
                    "style": item.style,
                    "model_name": item.model_name,
                    "created_at_ms": item.created_at,
                }
                for item in data.versions
            ],
        )
        return R.success(data={"added": added})
    except Exception as e:
        logger.error(f"同步版本失败 {data.task_id}: {e}", exc_info=True)
        return R.error(msg=f"同步版本失败: {e}")


@router.delete("/library/versions/{task_id}/{ver_id}")
def delete_version(task_id: str, ver_id: str):
    try:
        if not library_dao.delete_version(task_id, ver_id):
            return R.error(msg="版本不存在")
        return R.success()
    except Exception as e:
        logger.error(f"删除版本失败 {task_id}/{ver_id}: {e}", exc_info=True)
        return R.error(msg=f"删除版本失败: {e}")


@router.post("/library/touch")
def touch_note(data: TouchRequest):
    """进入详情页时调用，供书架页的「最近打开」一行排序。笔记不在索引里不算错误。"""
    try:
        library_dao.touch_note(data.task_id)
        return R.success()
    except Exception as e:
        logger.warning(f"更新最近打开时间失败 {data.task_id}: {e}")
        return R.success()
