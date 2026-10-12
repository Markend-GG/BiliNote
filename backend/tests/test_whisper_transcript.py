import json
import pathlib
import sys
import unittest
from dataclasses import asdict
from unittest.mock import MagicMock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

try:
    from app.transcriber.whisper import WhisperTranscriber, transcription_info_to_dict
    IMPORT_ERROR = None
except Exception as exc:  # 宿主没装 faster-whisper 时跳过，容器内会真跑
    IMPORT_ERROR = exc


class _FakeInfo:
    """faster-whisper 的 TranscriptionInfo：不是 dict，原样塞进 raw 会让 json.dumps 炸掉。"""

    language = "zh"
    language_probability = 0.99
    duration = 12.3
    model_id = "large-v3-turbo"
    device = "cuda"
    compute_type = "float16"
    all_language_probs = [("zh", 0.99)]  # 不该被带进 raw 的字段


class _FakeSegment:
    def __init__(self, start, end, text):
        self.start, self.end, self.text = start, end, text


@unittest.skipIf(IMPORT_ERROR is not None, f"需要 faster-whisper：{IMPORT_ERROR}")
class TestWhisperTranscript(unittest.TestCase):
    def _transcriber_with(self, transcribe):
        # 跳过 __init__（那会去加载真模型），只测 transcript() 的行为
        transcriber = WhisperTranscriber.__new__(WhisperTranscriber)
        transcriber.model = MagicMock()
        transcriber.model.transcribe = transcribe
        return transcriber

    def test_failure_is_raised_not_swallowed(self):
        """原来 except 里只 print、隐式返回 None，上层 asdict(None) 报的是
        "asdict() should be called on dataclass instances"，真正的错因被埋掉。"""
        transcriber = self._transcriber_with(
            MagicMock(side_effect=RuntimeError("Library libcublas.so.12 is not found or cannot be loaded"))
        )
        with self.assertRaises(RuntimeError) as ctx:
            transcriber.transcript("audio.mp3")
        self.assertIn("libcublas", str(ctx.exception))

    def test_result_can_be_written_to_transcript_cache(self):
        """上层就是用 json.dumps(asdict(transcript)) 写缓存的，raw 必须可序列化。"""
        transcriber = self._transcriber_with(
            MagicMock(return_value=(iter([_FakeSegment(0.0, 1.5, " 你好 ")]), _FakeInfo()))
        )
        result = transcriber.transcript("audio.mp3")
        dumped = json.loads(json.dumps(asdict(result), ensure_ascii=False))
        self.assertEqual(dumped["language"], "zh")
        self.assertEqual(dumped["full_text"], "你好")
        self.assertEqual(dumped["segments"], [{"start": 0.0, "end": 1.5, "text": "你好"}])
        self.assertEqual(dumped["raw"]["device"], "cuda")
        self.assertNotIn("all_language_probs", dumped["raw"])

    def test_info_to_dict_tolerates_missing_fields(self):
        self.assertEqual(
            transcription_info_to_dict(object()),
            {
                "language": None,
                "language_probability": None,
                "duration": None,
                "model_id": None,
                "device": None,
                "compute_type": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
