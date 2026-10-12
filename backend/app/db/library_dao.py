import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.db.engine import get_db
from app.db.models.library import Folder, NoteRecord
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _ms(dt: Optional[datetime]) -> Optional[int]:
    """SQLite 里存的是 naive UTC（func.now() 走 CURRENT_TIMESTAMP）。

    直接返回 ISO 字符串会被前端 new Date() 当成本地时间解析，界面就会比实际早/晚若干小时
    ——之前踩过这个坑。统一转成 epoch 毫秒，前端 new Date(ms) 没有歧义。
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _folder_to_dict(row: Folder) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "sort_order": row.sort_order or 0,
        "created_at": _ms(row.created_at),
    }


def _note_to_dict(row: NoteRecord) -> dict:
    try:
        form_data = json.loads(row.form_data) if row.form_data else None
    except (TypeError, ValueError):
        form_data = None
    return {
        "task_id": row.task_id,
        "title": row.title,
        "video_title": row.video_title,
        "folder_id": row.folder_id,
        "status": row.status,
        "video_id": row.video_id,
        "platform": row.platform,
        "cover_url": row.cover_url,
        "duration": row.duration,
        "created_at": _ms(row.created_at),
        "updated_at": _ms(row.updated_at),
        "last_opened_at": _ms(row.last_opened_at),
        "form_data": form_data,
    }


# ── 文件夹 ────────────────────────────────────────────────────


def list_folders() -> list[dict]:
    db = next(get_db())
    try:
        rows = db.query(Folder).order_by(Folder.sort_order.asc(), Folder.created_at.asc()).all()
        return [_folder_to_dict(r) for r in rows]
    finally:
        db.close()


def create_folder(name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("文件夹名称不能为空")
    db = next(get_db())
    try:
        if db.query(Folder).filter_by(name=name).first():
            raise ValueError(f"已存在同名文件夹：{name}")
        row = Folder(id=str(uuid.uuid4()), name=name, sort_order=0)
        db.add(row)
        db.commit()
        db.refresh(row)
        logger.info(f"已创建文件夹: {row.name} ({row.id})")
        return _folder_to_dict(row)
    finally:
        db.close()


def rename_folder(folder_id: str, name: str) -> Optional[dict]:
    name = (name or "").strip()
    if not name:
        raise ValueError("文件夹名称不能为空")
    db = next(get_db())
    try:
        row = db.query(Folder).filter_by(id=folder_id).first()
        if not row:
            return None
        clash = db.query(Folder).filter(Folder.name == name, Folder.id != folder_id).first()
        if clash:
            raise ValueError(f"已存在同名文件夹：{name}")
        row.name = name
        db.commit()
        db.refresh(row)
        return _folder_to_dict(row)
    finally:
        db.close()


def delete_folder(folder_id: str, mode: str) -> list[str]:
    """删除文件夹。

    mode='move'   → 里面的笔记归入未分类（folder_id 置空）
    mode='delete' → 连笔记一起删；这里只摘出 task_id 并删掉行，
                    真正的文件/截图/向量索引清理由调用方（library_service）执行。
    返回受影响的 task_id 列表（mode='move' 时返回空列表）。
    """
    db = next(get_db())
    try:
        row = db.query(Folder).filter_by(id=folder_id).first()
        if not row:
            return []
        notes = db.query(NoteRecord).filter_by(folder_id=folder_id).all()
        affected = [n.task_id for n in notes] if mode == "delete" else []
        if mode == "delete":
            for n in notes:
                db.delete(n)
        else:
            for n in notes:
                n.folder_id = None
        db.delete(row)
        db.commit()
        logger.info(f"已删除文件夹: {row.name} (mode={mode}, 涉及笔记 {len(notes)} 篇)")
        return affected
    finally:
        db.close()


# ── 笔记索引 ──────────────────────────────────────────────────


def list_notes() -> list[dict]:
    db = next(get_db())
    try:
        rows = db.query(NoteRecord).order_by(NoteRecord.created_at.desc()).all()
        return [_note_to_dict(r) for r in rows]
    finally:
        db.close()


def get_note(task_id: str) -> Optional[dict]:
    db = next(get_db())
    try:
        row = db.query(NoteRecord).filter_by(task_id=task_id).first()
        return _note_to_dict(row) if row else None
    finally:
        db.close()


def upsert_note(task_id: str, **fields) -> None:
    """写入/更新笔记索引。只更新显式传入且非 None 的字段。

    生命周期里会调用多次（提交时 PENDING、成功时补标题封面、失败时改状态），
    所以不能整行覆盖，否则后一次会把前一次写好的字段冲掉。
    要把 folder_id 置空请用 move_note()。
    """
    payload = {k: v for k, v in fields.items() if v is not None}
    if "form_data" in payload and not isinstance(payload["form_data"], str):
        payload["form_data"] = json.dumps(payload["form_data"], ensure_ascii=False)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db = next(get_db())
    try:
        row = db.query(NoteRecord).filter_by(task_id=task_id).first()
        if row is None:
            row = NoteRecord(task_id=task_id, created_at=now)
            db.add(row)
        for key, value in payload.items():
            if hasattr(row, key):
                setattr(row, key, value)
        row.updated_at = now
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"写入笔记索引失败 task_id={task_id}: {e}")
    finally:
        db.close()


def move_note(task_id: str, folder_id: Optional[str]) -> bool:
    db = next(get_db())
    try:
        row = db.query(NoteRecord).filter_by(task_id=task_id).first()
        if not row:
            return False
        if folder_id is not None and not db.query(Folder).filter_by(id=folder_id).first():
            raise ValueError("目标文件夹不存在")
        row.folder_id = folder_id
        row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        return True
    finally:
        db.close()


def rename_note(task_id: str, title: str) -> bool:
    db = next(get_db())
    try:
        row = db.query(NoteRecord).filter_by(task_id=task_id).first()
        if not row:
            return False
        row.title = (title or "").strip() or None
        row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        return True
    finally:
        db.close()


def touch_note(task_id: str) -> bool:
    db = next(get_db())
    try:
        row = db.query(NoteRecord).filter_by(task_id=task_id).first()
        if not row:
            return False
        row.last_opened_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        return True
    finally:
        db.close()


def delete_note_row(task_id: str) -> None:
    db = next(get_db())
    try:
        row = db.query(NoteRecord).filter_by(task_id=task_id).first()
        if row:
            db.delete(row)
            db.commit()
    finally:
        db.close()
