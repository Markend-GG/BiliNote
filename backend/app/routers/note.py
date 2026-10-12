# app/routers/note.py
import json
import os
import threading
import uuid
from enum import Enum
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
from pydantic import BaseModel, validator, field_validator, model_validator
from dataclasses import asdict

from app.db.video_task_dao import get_task_by_video
from app.db import library_dao
from app.services.library_service import delete_note_artifacts
from app.enmus.exception import NoteErrorEnum
from app.enmus.note_enums import DownloadQuality
from app.exceptions.note import NoteError
from app.services.note import NoteGenerator, logger
from app.services.task_serial_executor import task_serial_executor
from app.utils.response import ResponseWrapper as R
from app.utils.url_parser import extract_video_id, normalize_video_url
from app.validators.video_url_validator import is_supported_video_url
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
import httpx
from app.enmus.task_status_enums import TaskStatus

# from app.services.downloader import download_raw_audio
# from app.services.whisperer import transcribe_audio

router = APIRouter()


class DeleteTaskRequest(BaseModel):
    task_id: str


class VideoRequest(BaseModel):
    video_url: str
    platform: str
    quality: DownloadQuality
    screenshot: Optional[bool] = False
    link: Optional[bool] = False
    model_name: str
    provider_id: str
    task_id: Optional[str] = None
    format: Optional[list] = []
    style: str = None
    extras: Optional[str]=None
    video_understanding: Optional[bool] = False
    video_interval: Optional[int] = 0
    grid_size: Optional[list] = []
    # 客户端（如浏览器插件）已经在用户浏览器里抓到字幕，直接传给后端复用，
    # 跳过 download_subtitles 和音频转写。形如：
    #   {"language": "zh", "full_text": "...", "segments": [{"start","end","text"}, ...]}
    prefetched_transcript: Optional[dict] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_url(cls, data):
        # 稍后再看/收藏夹/带追踪参数的 B 站链接先规范化成标准 /video/BVxxx 形式，
        # 后续校验和 yt-dlp 下载拿到的都是干净链接
        if isinstance(data, dict) and data.get("platform") == "bilibili" and data.get("video_url"):
            data["video_url"] = normalize_video_url(str(data["video_url"]))
        return data

    @field_validator("video_url")
    def validate_supported_url(cls, v):
        url = str(v)
        parsed = urlparse(url)
        if parsed.scheme in ("http", "https"):
            # 是网络链接，继续用原有平台校验
            if not is_supported_video_url(url):
                raise NoteError(code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code,
                                message=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.message)

        return v


NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")
UPLOAD_DIR = "uploads"


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


def _persist_prefetched_transcript(task_id: str, transcript: dict) -> None:
    """把客户端预取的字幕写到 NoteGenerator 期望的转写缓存文件里。

    NoteGenerator.generate 会优先读 <task_id>_transcript.json，命中即跳过 download_subtitles
    与音频转写流程。要求字段：language(可空)/full_text/segments[{start,end,text}]
    """
    segments = transcript.get("segments") or []
    cleaned_segments = []
    for s in segments:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        cleaned_segments.append({
            "start": float(s.get("start", 0)),
            "end": float(s.get("end", 0)),
            "text": text,
        })
    if not cleaned_segments:
        raise ValueError("prefetched_transcript 没有可用的 segments")

    full_text = transcript.get("full_text") or " ".join(s["text"] for s in cleaned_segments)
    payload = {
        "language": transcript.get("language") or "zh",
        "full_text": full_text,
        "segments": cleaned_segments,
    }

    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    target = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}_transcript.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info(f"已写入客户端预取字幕缓存: {target} ({len(cleaned_segments)} 段)")


# 同一个 task_id 在跑时忽略重复提交：抽帧加生成要几分钟，界面上看着像卡住，用户很容易再点一次「重试」；
# 而任务执行器其实是并发线程池（ConcurrentTaskExecutor），两次同时跑会互相删掉对方的中间帧文件
_running_tasks: set[str] = set()
_running_tasks_lock = threading.Lock()


def run_note_task(task_id: str, video_url: str, platform: str, quality: DownloadQuality,
                  link: bool = False, screenshot: bool = False, model_name: str = None, provider_id: str = None,
                  _format: list = None, style: str = None, extras: str = None, video_understanding: bool = False,
                  video_interval=0, grid_size=[]
                  ):

    if not model_name or not provider_id:
        raise HTTPException(status_code=400, detail="请选择模型和提供者")

    with _running_tasks_lock:
        if task_id in _running_tasks:
            logger.warning(f"任务 {task_id} 正在执行中，忽略重复提交")
            return
        _running_tasks.add(task_id)

    try:
        _run_note_task_inner(task_id, video_url, platform, quality, link, screenshot, model_name, provider_id,
                             _format, style, extras, video_understanding, video_interval, grid_size)
    finally:
        with _running_tasks_lock:
            _running_tasks.discard(task_id)


def _run_note_task_inner(task_id: str, video_url: str, platform: str, quality: DownloadQuality,
                         link: bool, screenshot: bool, model_name: str, provider_id: str,
                         _format: list, style: str, extras: str, video_understanding: bool,
                         video_interval, grid_size):

    def _execute_note_task():
        return NoteGenerator().generate(
            video_url=video_url,
            platform=platform,
            quality=quality,
            task_id=task_id,
            model_name=model_name,
            provider_id=provider_id,
            link=link,
            _format=_format,
            style=style,
            extras=extras,
            screenshot=screenshot,
            video_understanding=video_understanding,
            video_interval=video_interval,
            grid_size=grid_size,
        )

    logger.info(f"任务进入执行队列 (task_id={task_id})")
    try:
        note = task_serial_executor.run(_execute_note_task)
    except Exception as e:
        logger.error(f"任务 {task_id} 执行异常: {e}", exc_info=True)
        _index_note(task_id, "FAILED", platform=platform)
        raise
    logger.info(f"Note generated: {task_id}")
    if not note or not note.markdown:
        logger.warning(f"任务 {task_id} 执行失败，跳过保存")
        _index_note(task_id, "FAILED", platform=platform)
        return
    save_note_to_file(task_id, note)
    _index_note(task_id, "SUCCESS", audio_meta=asdict(note.audio_meta) if note.audio_meta else None,
                platform=platform)

    # 自动建立向量索引（用于 AI 问答），失败不影响笔记生成
    try:
        from app.services.vector_store import VectorStoreManager
        VectorStoreManager().index_task(task_id)
    except Exception as e:
        logger.warning(f"向量索引失败（不影响笔记）: {e}")


@router.post('/delete_task')
def delete_task(data: DeleteTaskRequest):
    """真正删除一篇笔记：note_results 下的 5 个文件、它引用的截图、SQLite 行、向量索引。

    这里以前是个空壳（请求体被注释掉、无条件返回成功），界面上的"删除"只是让它从浏览器
    IndexedDB 消失，盘上的 json 和截图一直堆着。
    """
    try:
        result = delete_note_artifacts(data.task_id)
        return R.success(data=result, msg='删除成功')
    except Exception as e:
        logger.error(f"删除笔记失败 {data.task_id}: {e}", exc_info=True)
        return R.error(msg=f'删除失败: {e}')


class UpdateNoteRequest(BaseModel):
    task_id: str
    markdown: str


def _reindex_note(task_id: str):
    try:
        from app.services.vector_store import VectorStoreManager
        VectorStoreManager().index_task(task_id)
        logger.info(f"编辑后重新索引完成: {task_id}")
    except Exception as e:
        logger.warning(f"编辑后重新索引失败（不影响笔记）: {e}")


@router.post('/update_note')
def update_note(data: UpdateNoteRequest, background_tasks: BackgroundTasks):
    """保存用户手动编辑后的笔记内容（同步更新索引，供 AI 问答使用）。"""
    if not data.markdown.strip():
        return R.error(msg='笔记内容不能为空')
    note_path = os.path.join(NOTE_OUTPUT_DIR, f"{data.task_id}.json")
    if not os.path.exists(note_path):
        return R.error(msg='笔记文件不存在，无法保存')
    try:
        with open(note_path, 'r', encoding='utf-8') as f:
            note_data = json.load(f)
        note_data['markdown'] = data.markdown
        with open(note_path, 'w', encoding='utf-8') as f:
            json.dump(note_data, f, ensure_ascii=False, indent=2)

        md_cache = os.path.join(NOTE_OUTPUT_DIR, f"{data.task_id}_markdown.md")
        with open(md_cache, 'w', encoding='utf-8') as f:
            f.write(data.markdown)

        background_tasks.add_task(_reindex_note, data.task_id)
        logger.info(f"笔记已手动编辑保存: {data.task_id}")
        return R.success(msg='保存成功')
    except Exception as e:
        logger.error(f"保存笔记失败: {e}")
        return R.error(msg=f'保存失败: {e}')


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_location = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_location, "wb+") as f:
        f.write(await file.read())

    # 假设你静态目录挂载了 /uploads
    return R.success({"url": f"/uploads/{file.filename}"})


@router.post("/generate_note")
def generate_note(data: VideoRequest, background_tasks: BackgroundTasks):
    try:
        # 就绪门禁：本地转写引擎（fast-whisper / mlx-whisper）必须等模型下载完才能跑视频，
        # 否则任务会卡在首次下载（慢 / OOM / 截断），用户只看到一个静默失败的任务。
        # 客户端已抓好字幕（prefetched_transcript）则不需要转写，跳过检查。
        if not data.prefetched_transcript:
            from app.services.transcriber_config_manager import TranscriberConfigManager
            readiness = TranscriberConfigManager().is_model_ready()
            if not readiness["ready"]:
                logger.warning(f"拒绝 generate_note：{readiness['reason']}")
                return R.error(
                    msg=readiness["reason"],
                    code=300102,
                    data={
                        "reason": "transcriber_model_not_ready",
                        "transcriber_type": readiness["transcriber_type"],
                        "model_size": readiness["model_size"],
                        "downloading": readiness["downloading"],
                    },
                )

        video_id = extract_video_id(data.video_url, data.platform)
        # if not video_id:
        #     raise HTTPException(status_code=400, detail="无法提取视频 ID")
        # existing = get_task_by_video(video_id, data.platform)
        # if existing:
        #     return R.error(
        #         msg='笔记已生成，请勿重复发起',
        #
        #     )
        if data.task_id:
            # 如果传了task_id，说明是重试！
            task_id = data.task_id
            logger.info(f"重试模式，复用已有 task_id={task_id}")
        else:
            # 正常新建任务
            task_id = str(uuid.uuid4())

        # 统一先写入 PENDING，表示已进入队列等待串行执行
        NoteGenerator()._update_status(task_id, TaskStatus.PENDING)
        # 同步登记进笔记库索引，这样"生成中"的笔记立刻出现在书架页上
        _index_note(task_id, TaskStatus.PENDING.value, platform=data.platform, form_data=_form_snapshot(data))

        # 客户端已经抓好字幕的话，写到转写缓存文件，NoteGenerator 的 cache-hit 逻辑会直接用上
        if data.prefetched_transcript:
            try:
                _persist_prefetched_transcript(task_id, data.prefetched_transcript)
            except Exception as e:
                logger.warning(f"写入预取字幕失败 (task_id={task_id}): {e}")

        background_tasks.add_task(run_note_task, task_id, data.video_url, data.platform, data.quality, data.link,
                                  data.screenshot, data.model_name, data.provider_id, data.format, data.style,
                                  data.extras, data.video_understanding, data.video_interval, data.grid_size)
        return R.success({"task_id": task_id})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/task_status/{task_id}")
def get_task_status(task_id: str):
    status_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.status.json")
    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")

    # 优先读状态文件
    if os.path.exists(status_path):
        with open(status_path, "r", encoding="utf-8") as f:
            status_content = json.load(f)

        status = status_content.get("status")
        message = status_content.get("message", "")

        if status == TaskStatus.SUCCESS.value:
            # 成功状态的话，继续读取最终笔记内容
            if os.path.exists(result_path):
                with open(result_path, "r", encoding="utf-8") as rf:
                    result_content = json.load(rf)
                return R.success({
                    "status": status,
                    "result": result_content,
                    "message": message,
                    "task_id": task_id
                })
            else:
                # 理论上不会出现，保险处理
                return R.success({
                    "status": TaskStatus.PENDING.value,
                    "message": "任务完成，但结果文件未找到",
                    "task_id": task_id
                })

        if status == TaskStatus.FAILED.value:
            return R.error(message or "任务失败", code=500)

        # 处理中状态
        return R.success({
            "status": status,
            "message": message,
            "task_id": task_id
        })

    # 没有状态文件，但有结果
    if os.path.exists(result_path):
        with open(result_path, "r", encoding="utf-8") as f:
            result_content = json.load(f)
        return R.success({
            "status": TaskStatus.SUCCESS.value,
            "result": result_content,
            "task_id": task_id
        })

    # 什么都没有，默认PENDING
    return R.success({
        "status": TaskStatus.PENDING.value,
        "message": "任务排队中",
        "task_id": task_id
    })


@router.get("/image_proxy")
async def image_proxy(request: Request, url: str):
    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": request.headers.get("User-Agent", ""),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)

            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="图片获取失败")

            content_type = resp.headers.get("Content-Type", "image/jpeg")
            return StreamingResponse(
                resp.aiter_bytes(),
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",  #  缓存一天
                    "Content-Type": content_type,
                }
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
