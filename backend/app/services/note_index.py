"""笔记索引与落盘：notes 表登记、表单参数快照、结果文件写入。

从 routers/note.py 拆出来：路由文件只该管请求/响应，持久化细节集中在这里。
"""

import json
import os
from enum import Enum
from dataclasses import asdict
from typing import Optional

from app.db import library_dao
from app.utils.logger import get_logger

logger = get_logger(__name__)

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def save_note_to_file(task_id: str, note):
    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    with open(os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json"), "w", encoding="utf-8") as f:
        json.dump(asdict(note), f, ensure_ascii=False, indent=2)


def _index_note(task_id: str, status: str, audio_meta: Optional[dict] = None, platform: Optional[str] = None,
                form_data: Optional[dict] = None) -> None:
    """把笔记登记进笔记库索引（书架页的数据源）。

    索引写失败不该影响生成流程，所以整段吞掉异常只记日志。
    upsert_note 只覆盖显式传入的非 None 字段，提交时的 PENDING 不会把成功后补的标题冲掉。
    """
    try:
        fields = {"status": status}
        if platform:
            fields["platform"] = platform
        if form_data:
            fields["form_data"] = form_data
        if audio_meta:
            fields.update({
                "video_title": audio_meta.get("title"),
                "cover_url": audio_meta.get("cover_url"),
                "duration": audio_meta.get("duration"),
                "platform": audio_meta.get("platform") or platform,
                "video_id": audio_meta.get("video_id"),
            })
        library_dao.upsert_note(task_id, **fields)
    except Exception as e:
        logger.warning(f"写入笔记库索引失败（不影响生成）{task_id}: {e}")


# 详情页刷新后如果浏览器本地记录丢了，「重新生成」要靠这份快照恢复原来的链接/风格/模型。
# 刻意不含 prefetched_transcript：那是整篇字幕，体积大且能从转写缓存文件重新拿到。
_FORM_SNAPSHOT_FIELDS = (
    "video_url", "platform", "quality", "screenshot", "link", "model_name",
    "provider_id", "format", "style", "extras", "video_understanding",
    "video_interval", "grid_size",
)


def _form_snapshot(data: "VideoRequest") -> dict:
    snapshot = {}
    for key in _FORM_SNAPSHOT_FIELDS:
        value = getattr(data, key, None)
        snapshot[key] = value.value if isinstance(value, Enum) else value
    return snapshot
