from dataclasses import dataclass, field
from typing import List, Optional

from app.models.audio_model import AudioDownloadResult
from app.models.transcriber_model import TranscriptResult


@dataclass
class NoteResult:
    markdown: str                  # GPT 总结的 Markdown 内容
    transcript: TranscriptResult                # Whisper 转写结果
    audio_meta: AudioDownloadResult  # 音频下载的元信息（title、duration、封面等）
    # 这篇笔记实际引用的截图文件名清单。删除笔记时按清单清文件，
    # 不再只靠正则从 markdown 里反查（用户编辑删图后反查就漏，截图变孤儿）
    screenshots: List[str] = field(default_factory=list)