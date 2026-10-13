"""笔记索引与落盘：notes 表登记、表单参数快照、结果文件写入。

从 routers/note.py 拆出来：路由文件只该管请求/响应，持久化细节集中在这里。
"""

import json
import os
from enum import Enum
from dataclasses import asdict
from pathlib import Path
from typing import Optional, Union

from app.db import library_dao
from app.enmus.task_status_enums import TaskStatus
from app.utils.logger import get_logger

logger = get_logger(__name__)

NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")


def write_status_file(task_id: str, status: Union[str, TaskStatus], message: Optional[str] = None) -> None:
    """写 {task_id}.status.json（临时文件 + 原子替换）。前端轮询读的就是它。

    刻意做成模块级函数、不依赖 NoteGenerator：提交接口只需要落一个 PENDING 状态，
    而 `NoteGenerator()` 的构造会把 Whisper 模型加载进显存——实测首次 4.7s、冷启动 8.4s，
    再加上"闲置 600 秒自动卸载"，超过 10 分钟没生成，下一次点「生成笔记」就要干等这么久
    （旧的 10 秒请求超时正好卡在这条线上，于是"报错但后台其实在跑"）。
    """
    if not task_id:
        return

    out_dir = Path(NOTE_OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    status_file = out_dir / f"{task_id}.status.json"
    data = {"status": status.value if isinstance(status, TaskStatus) else str(status)}
    if message:
        data["message"] = message

    temp_file = status_file.with_suffix(".tmp")
    try:
        with temp_file.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        temp_file.replace(status_file)
        logger.info(f"状态更新 {task_id}: {data['status']}")
    except Exception as e:
        # 不再把错误文本直接写进状态文件：那会造出一个 json.load 解析不了的文件，
        # 让 /task_status 直接 500，任务在界面上永远卡住
        logger.error(f"写入状态文件失败 (task_id={task_id})：{e}")


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
