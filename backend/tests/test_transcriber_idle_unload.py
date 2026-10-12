import pathlib
import sys
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

try:
    from app.transcriber import transcriber_provider as tp
    from app.transcriber.transcriber_provider import (
        TranscriberType,
        touch_transcriber,
        unload_idle_transcribers,
    )
    IMPORT_ERROR = None
except Exception as exc:  # 宿主没装 faster-whisper 时跳过，容器内会真跑
    IMPORT_ERROR = exc


class _Fake:
    def __init__(self):
        self.unloaded = 0

    def unload(self):
        self.unloaded += 1


@unittest.skipIf(IMPORT_ERROR is not None, f"需要 faster-whisper：{IMPORT_ERROR}")
class TestIdleUnload(unittest.TestCase):
    def setUp(self):
        self._saved_transcribers = dict(tp._transcribers)
        self._saved_last_used = dict(tp._last_used)

    def tearDown(self):
        tp._transcribers.clear()
        tp._transcribers.update(self._saved_transcribers)
        tp._last_used.clear()
        tp._last_used.update(self._saved_last_used)

    def test_idle_instance_is_unloaded_and_cache_cleared(self):
        fake = _Fake()
        tp._transcribers[TranscriberType.FAST_WHISPER] = fake
        tp._last_used[TranscriberType.FAST_WHISPER] = time.monotonic() - 700
        unloaded = unload_idle_transcribers(600)
        self.assertEqual(unloaded, [TranscriberType.FAST_WHISPER])
        self.assertEqual(fake.unloaded, 1)
        self.assertIsNone(tp._transcribers[TranscriberType.FAST_WHISPER])
        self.assertIsNone(tp._transcriber_configs[TranscriberType.FAST_WHISPER])

    def test_recently_used_instance_is_kept(self):
        fake = _Fake()
        tp._transcribers[TranscriberType.FAST_WHISPER] = fake
        touch_transcriber(TranscriberType.FAST_WHISPER)
        self.assertEqual(unload_idle_transcribers(600), [])
        self.assertEqual(fake.unloaded, 0)
        self.assertIs(tp._transcribers[TranscriberType.FAST_WHISPER], fake)

    def test_instance_without_unload_method_is_still_dropped(self):
        tp._transcribers[TranscriberType.BCUT] = object()
        tp._last_used[TranscriberType.BCUT] = time.monotonic() - 700
        self.assertEqual(unload_idle_transcribers(600), [TranscriberType.BCUT])

    def test_whisper_unload_clears_model_and_is_idempotent(self):
        from app.transcriber.whisper import WhisperTranscriber

        transcriber = WhisperTranscriber.__new__(WhisperTranscriber)  # 不加载真模型
        transcriber.model = object()
        transcriber.unload()
        self.assertIsNone(transcriber.model)
        transcriber.unload()  # 重复调用不能炸
        self.assertIsNone(transcriber.model)


if __name__ == "__main__":
    unittest.main()
