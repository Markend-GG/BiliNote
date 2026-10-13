"""笔记库的落地操作：删除一篇笔记的全部产物、启动时回填历史笔记索引。

放在 service 层而不是 router 里，是因为 routers/note.py（删除单篇）和
routers/library.py（删文件夹时连带删笔记）都要用，放任一边都会造成互相 import。
"""

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from app.db import library_dao, search_dao, video_task_dao
from app.utils.logger import get_logger

logger = get_logger(__name__)

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")
IMAGE_OUTPUT_DIR = Path(os.getenv("OUT_DIR", "./static/screenshots"))
VECTOR_DB_DIR = os.getenv("VECTOR_DB_DIR", "vector_db")

# 截图文件名形如 screenshot_003_<uuid4>.jpg（utils/video_helper.py:22），uuid4 保证全局唯一，
# 所以能靠 markdown 里的引用反查某篇笔记拥有哪些截图。
_SCREENSHOT_NAME_RE = re.compile(r"screenshot_\d{3}_[0-9a-fA-F-]{36}\.jpg")
# note_results 下只有 {task_id}.json 是"一篇笔记"，其余带下划线的都是派生缓存
_NOTE_FILE_RE = re.compile(r"^[0-9a-fA-F-]{36}\.json$")

# 生成一篇笔记时截图是先落盘的，note json 要等总结写完才有——中间这几分钟里，
# 新截图在引用集里查不到，会被判成孤儿。给一个宽限期，别把正在生成的笔记的图列出来让人删。
_ORPHAN_GRACE_MS = 30 * 60 * 1000


def _within_grace(mtime_ms: float, now_ms: float) -> bool:
    """宽限期关掉（<=0）时一律返回 False，测试才能确定性地验引用逻辑本身。"""
    return _ORPHAN_GRACE_MS > 0 and now_ms - mtime_ms < _ORPHAN_GRACE_MS

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
                payload = json.load(f)
            # 清单为主（生成时写下的真实引用），正则兜底（老笔记/清单被编辑过的情况）。
            # 清单内容不可信程度等同于用户输入：必须过一遍文件名形态校验，防路径穿越
            manifest = payload.get("screenshots")
            if isinstance(manifest, list):
                referenced.update(
                    name for name in manifest
                    if isinstance(name, str) and _SCREENSHOT_NAME_RE.fullmatch(name)
                )
            referenced.update(_referenced_screenshots(payload))
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
        search_dao.delete_note(task_id)
    except Exception as e:
        logger.warning(f"删除全文索引失败 {task_id}: {e}")

    try:
        from app.services.vector_store import VectorStoreManager

        VectorStoreManager().delete_index(task_id)
    except Exception as e:
        logger.warning(f"删除向量索引失败 {task_id}: {e}")

    logger.info(
        f"已删除笔记 {task_id}：文件 {deleted_files} 个，截图 {deleted_screenshots} 张"
    )
    return {"deleted_files": deleted_files, "deleted_screenshots": deleted_screenshots}


def _fts_missing(task_id: str) -> bool:
    try:
        return search_dao.count_note(task_id) == 0
    except Exception:
        # 索引表本身有问题时别在启动路径上刷一堆日志，搜索接口自己会报错
        return False


def _reindex_from_file(path: Path, task_id: str) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"补建全文索引时读取失败 {path.name}: {e}")
        return False
    try:
        search_dao.rebuild_note(task_id, data.get("markdown", "") or "")
        return True
    except Exception as e:
        logger.warning(f"补建全文索引失败 {task_id}: {e}")
        return False


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
    reindexed = 0
    for path in sorted(note_dir.iterdir()):
        if not _NOTE_FILE_RE.match(path.name):
            continue
        task_id = path.stem
        if task_id in existing:
            # 库里已经有了，但可能是"全文索引这个功能上线之前"就进来的：那批笔记在
            # note_fts 里一行都没有，搜索永远搜不到它们。缺索引才读 json，补建一次
            if _fts_missing(task_id) and _reindex_from_file(path, task_id):
                reindexed += 1
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"回填时读取失败，跳过 {path.name}: {e}")
            continue

        meta = data.get("audio_meta") or {}
        raw = meta.get("raw_info") or {}
        # 老笔记没有 screenshots 清单：按 markdown 反查补写一次（幂等）。
        # 之后删除笔记、清理孤儿截图都以清单为准，反查只作兜底
        if not isinstance(data.get("screenshots"), list):
            data["screenshots"] = sorted(_SCREENSHOT_NAME_RE.findall(data.get("markdown", "") or ""))
            try:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            except Exception as e:
                logger.warning(f"回填截图清单失败 {path.name}: {e}")
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
        try:
            search_dao.rebuild_note(task_id, data.get("markdown", "") or "")
        except Exception as e:
            logger.warning(f"回填全文索引失败 {task_id}: {e}")
        added += 1

    if added:
        logger.info(f"已回填 {added} 篇历史笔记到笔记库索引")
    if reindexed:
        logger.info(f"已为 {reindexed} 篇存量笔记补建全文索引")
    return added


# ── 存储扫描 / 孤儿截图清理 ────────────────────────────────────


def _dir_bytes(path: Path) -> int:
    if not path.is_dir():
        return 0
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def referenced_screenshot_names() -> set:
    """所有笔记真正引用的截图文件名：清单为主、正则兜底。"""
    refs = set()
    note_dir = Path(NOTE_OUTPUT_DIR)
    if not note_dir.is_dir():
        return refs
    for path in note_dir.iterdir():
        if not _NOTE_FILE_RE.match(path.name):
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            # json 坏了（写到一半崩了、老文件损坏）不等于这篇笔记不引用截图。
            # 直接跳过会把它引用的截图全判成孤儿，用户在存储页一点"清理"就真删了，
            # 所以退化成对原始文本跑正则——坏 json 里照样能捞到 ![](/static/screenshots/xxx.jpg)
            refs.update(_SCREENSHOT_NAME_RE.findall(raw))
            logger.warning(f"笔记 json 解析失败，改用正则提取截图引用: {path.name}")
            continue
        manifest = data.get("screenshots")
        if isinstance(manifest, list):
            refs.update(
                name for name in manifest
                if isinstance(name, str) and _SCREENSHOT_NAME_RE.fullmatch(name)
            )
        refs.update(_SCREENSHOT_NAME_RE.findall(data.get("markdown", "") or ""))
    return refs


def scan_storage() -> dict:
    """设置页「存储」的数据源：截图目录占用、孤儿清单、笔记/向量库体积。"""
    refs = referenced_screenshot_names()
    now_ms = int(time.time() * 1000)
    files = []
    if IMAGE_OUTPUT_DIR.is_dir():
        for path in IMAGE_OUTPUT_DIR.iterdir():
            if path.is_file() and _SCREENSHOT_NAME_RE.fullmatch(path.name):
                stat = path.stat()
                files.append({
                    "name": path.name,
                    "size": stat.st_size,
                    "mtime": int(stat.st_mtime * 1000),
                    "referenced": path.name in refs,
                })
    orphans = sorted(
        (
            f for f in files
            if not f["referenced"] and not _within_grace(f["mtime"], now_ms)
        ),
        key=lambda f: -f["size"],
    )
    return {
        "screenshots": {
            "count": len(files),
            "bytes": sum(f["size"] for f in files),
            "orphan_count": len(orphans),
            "orphan_bytes": sum(f["size"] for f in orphans),
        },
        "orphans": orphans,
        "note_results_bytes": _dir_bytes(Path(NOTE_OUTPUT_DIR)),
        "vector_db_bytes": _dir_bytes(Path(VECTOR_DB_DIR)),
    }


def delete_orphan_screenshots(names: list) -> dict:
    """删除孤儿截图。删除前重算引用集：界面上扫完到点删除之间可能又生成了新笔记。"""
    refs = referenced_screenshot_names()
    deleted, skipped = [], []
    for name in names:
        # 名字形态校验是第一道闸（防路径穿越），引用校验是第二道
        if not isinstance(name, str) or not _SCREENSHOT_NAME_RE.fullmatch(name):
            skipped.append(name)
            continue
        if name in refs:
            skipped.append(name)
            continue
        target = IMAGE_OUTPUT_DIR / name
        if not target.resolve().is_relative_to(IMAGE_OUTPUT_DIR.resolve()):
            skipped.append(name)
            continue
        # 界面扫完到点删除之间可能正好有新笔记在生成，宽限期内的文件一律不删
        try:
            if _within_grace(target.stat().st_mtime * 1000, time.time() * 1000):
                skipped.append(name)
                continue
        except OSError:
            skipped.append(name)
            continue
        if _unlink(target):
            deleted.append(name)
        else:
            skipped.append(name)
    logger.info(f"孤儿截图清理：删除 {len(deleted)} 张，跳过 {len(skipped)} 张")
    return {"deleted": deleted, "skipped": skipped}
