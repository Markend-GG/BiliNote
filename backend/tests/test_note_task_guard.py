import pathlib
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.routers import note as note_router


class TestDuplicateSubmitGuard(unittest.TestCase):
    def test_same_task_submitted_twice_runs_once(self):
        """抽帧加生成要几分钟，用户重复点「重试」时第二次必须被忽略——
        否则两次 VideoReader.run() 会互相删掉对方的中间帧文件。"""
        entered = threading.Event()
        release = threading.Event()
        calls = []

        class FakeGenerator:
            def generate(self, **kwargs):
                calls.append(kwargs["task_id"])
                entered.set()
                release.wait(5)
                return None

        args = ("task-guard", "https://www.bilibili.com/video/BV1xx", "bilibili", "medium")
        kwargs = {"model_name": "m", "provider_id": "p"}

        with patch.object(note_router, "NoteGenerator", FakeGenerator):
            first = threading.Thread(target=note_router.run_note_task, args=args, kwargs=kwargs)
            first.start()
            try:
                self.assertTrue(entered.wait(5), "第一个任务没有进入执行")
                note_router.run_note_task(*args, **kwargs)  # 重复提交，应立即返回
            finally:
                release.set()
                first.join(10)

        self.assertEqual(calls, ["task-guard"])
        self.assertNotIn("task-guard", note_router._running_tasks)


if __name__ == "__main__":
    unittest.main()
