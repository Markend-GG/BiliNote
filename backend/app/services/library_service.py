"""笔记库的落地操作：删除一篇笔记的全部产物、启动时回填历史笔记索引。

放在 service 层而不是 router 里，是因为 routers/note.py（删除单篇）和
routers/library.py（删文件夹时连带删笔记）都要用，放任一边都会造成互相 import。
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from app.db import library_dao, video_task_dao
from app.utils.logger import get_logger

logger = get_logger(__name__)

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")
IMAGE_OUTPUT_DIR = Path(os.getenv("OUT_DIR", "./static/screenshots"))

# 截图文件名形如 screenshot_003_<uuid4>.jpg（utils/video_helper.py:22），uuid4 保证全局唯一，
# 所以能靠 markdown 里的引用反查某篇笔记拥有哪些截图。
_SCREENSHOT_NAME_RE = re.compile(r"screenshot_\d{3}_[0-9a-fA-F-]{36}\.jpg")
# note_results 下只有 {task_id}.json 是"一篇笔记"，其余带下划线的都是派生缓存
_NOTE_FILE_RE = re.compile(r"^[0-9a-fA-F-]{36}\.json$")

# 一篇笔记在 note_results 下的全部文件。
# _markdown.status.json 是历史遗留：早期有个 bug 会把 SUMMARIZING 状态写到这个文件名上，
# 现有数据里确实存在，删除时一并清掉。
_NOTE_FILE_SUFFIXES = (
    ".json",
    ".status.json",
    "_audio.json",
    "_transcript.json",
    "_markdown.md",
    "_markdown.status.json",
)


def _referenced_screenshots(note_data: dict) -> set[str]:
    """从笔记 markdown 里摘出它引用的截图文件名（只要 basename，防路径穿越）。"""
    markdown = note_data.get("markdown", "") or ""
    return set(_SCREENSHOT_NAME_RE.findall(markdown))


def _unlink(path: Path) -> bool:
    try:
        if path.is_file():
            path.unlink()
            return True
    except OSError as e:
        logger.warning(f"删除文件失败 {path}: {e}")
    return False


def delete_note_artifacts(task_id: str) -> dict:
    """删掉一篇笔记在磁盘、SQLite、向量库里的全部痕迹。

    任何一步失败只记日志、继续删其余的，最后返回实际删除计数——
    删到一半就抛异常会留下更难以清理的残骸。
    """
    deleted_files = 0
    deleted_screenshots = 0

    note_path = Path(NOTE_OUTPUT_DIR) / f"{task_id}.json"
    referenced: set[str] = set()
    if note_path.is_file():
        try:
            with open(note_path, "r", encoding="utf-8") as f:
                referenced = _referenced_screenshots(json.load(f))
        except Exception as e:
            logger.warning(f"读取笔记 json 失败，跳过截图清理 {task_id}: {e}")

    for suffix in _NOTE_FILE_SUFFIXES:
        if _unlink(Path(NOTE_OUTPUT_DIR) / f"{task_id}{suffix}"):
            deleted_files += 1

    for name in referenced:
        target = IMAGE_OUTPUT_DIR / name
        # 双保险：正则已经限定了文件名形态，这里再确认解析后仍在截图目录内
        if target.resolve().is_relative_to(IMAGE_OUTPUT_DIR.resolve()) and _unlink(target):
            deleted_screenshots += 1

    try:
        video_task_dao.delete_by_task_id(task_id)
    except Exception as e:
        logger.warning(f"删除 video_tasks 记录失败 {task_id}: {e}")

    library_dao.delete_note_row(task_id)

    try:
        from app.services.vector_store import VectorStoreManager

        VectorStoreManager().delete_index(task_id)
    except Exception as e:
        logger.warning(f"删除向量索引失败 {task_id}: {e}")

    logger.info(
        f"已删除笔记 {task_id}：文件 {deleted_files} 个，截图 {deleted_screenshots} 张"
    )
    return {"deleted_files": deleted_files, "deleted_screenshots": deleted_screenshots}


def backfill_library() -> int:
    """启动时把 note_results/ 里已有但没进 notes 表的笔记补进去。

    这是"清浏览器缓存也能找回历史"的兜底：以前历史列表完全依赖浏览器 IndexedDB，
    盘上的 json 没有任何接口能列出来。幂等，失败不阻断启动。
    """
    note_dir = Path(NOTE_OUTPUT_DIR)
    if not note_dir.is_dir():
        return 0

    existing = {n["task_id"] for n in library_dao.list_notes()}
    added = 0
    for path in sorted(note_dir.iterdir()):
        if not _NOTE_FILE_RE.match(path.name):
            continue
        task_id = path.stem
        if task_id in existing:
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"回填时读取失败，跳过 {path.name}: {e}")
            continue

        meta = data.get("audio_meta") or {}
        raw = meta.get("raw_info") or {}
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).replace(tzinfo=None)
        library_dao.upsert_note(
            task_id,
            video_title=meta.get("title"),
            platform=meta.get("platform"),
            cover_url=meta.get("cover_url"),
            duration=meta.get("duration"),
            video_id=meta.get("video_id"),
            status="SUCCESS",
            created_at=mtime,
            # 老笔记没有留下生成参数，至少把链接和平台补上，
            # 否则浏览器本地记录丢了以后「重新生成」会是一张空表单
            form_data={
                "video_url": raw.get("webpage_url") or "",
                "platform": meta.get("platform") or "",
            },
        )
        added += 1

    if added:
        logger.info(f"已回填 {added} 篇历史笔记到笔记库索引")
    return added
