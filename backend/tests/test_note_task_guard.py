import pathlib
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from tests.isolation import IsolatedEnv  # noqa: E402

# _run_note_task_inner 里会写笔记库索引，不隔离就会在仓库里留下一个空的 bili_note.db
ENV = IsolatedEnv("bilinote-guard-test-")

from app.routers import note as note_router  # noqa: E402
from app.services import note as note_service  # noqa: E402


class TestDuplicateSubmitGuard(unittest.TestCase):
    def setUp(self):
        ENV.bind()

    def tearDown(self):
        # 这几个是模块级注册表，用完必须清干净，否则用例之间会互相影响
        note_router._inflight_keys.clear()
        note_router._key_by_task.clear()
        note_router._running_tasks.clear()
        note_service._download_locks.clear()

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

    def test_same_video_and_style_dedupes(self):
        """一次点击发出两个请求（实测两个新 task_id 只差 0.5ms）时，第二个必须复用第一个：
        否则两份 yt-dlp 写同一个 {video_id}.mp4.part，后完成的那个 rename 撞 Errno 2，
        整篇笔记 FAILED，还白烧一遍 API 额度。"""
        key = note_router._submit_key("BV1py", "https://b23.tv/x", "xingce_course")
        self.assertIsNone(note_router._claim_submit(key, "t1"))
        self.assertEqual(note_router._claim_submit(key, "t2"), "t1")
        # 第一个跑完后要放开，否则这条视频这个风格再也生成不了
        note_router._release_submit("t1")
        self.assertIsNone(note_router._claim_submit(key, "t3"))

    def test_different_style_of_same_video_is_allowed(self):
        """同一个视频生成「行测课程」和「行测速查卡」是正常用法，不能被去重挡掉。"""
        a = note_router._submit_key("BV1py", "https://b23.tv/x", "xingce_course")
        b = note_router._submit_key("BV1py", "https://b23.tv/x", "xingce_cheatsheet")
        self.assertIsNone(note_router._claim_submit(a, "t1"))
        self.assertIsNone(note_router._claim_submit(b, "t2"))

    def test_retry_of_same_task_is_not_deduped(self):
        """重试走的是同一个 task_id，不能把自己当成重复提交挡掉。"""
        key = note_router._submit_key("BV1py", "https://b23.tv/x", "xingce_course")
        self.assertIsNone(note_router._claim_submit(key, "t1"))
        self.assertIsNone(note_router._claim_submit(key, "t1"))

    def test_download_lock_is_per_video(self):
        """并发保护按视频 URL 取锁：同视频同一把（串行下载），不同视频互不阻塞。"""
        self.assertIs(note_service._download_lock("u1"), note_service._download_lock("u1"))
        self.assertIsNot(note_service._download_lock("u1"), note_service._download_lock("u2"))


class TestSubmitPathStaysLight(unittest.TestCase):
    """提交接口不许构造 NoteGenerator。

    它的构造函数会把 Whisper 模型压进显存（实测热态 4.7s、冷启动 8.4s），而提交只需要写一个
    PENDING 状态文件。叠加"闲置 600s 自动卸载显存"之后，超过 10 分钟没生成，用户点一次
    「生成笔记」就要干等这么久——旧的 10s 请求超时正好卡在这条线上，于是出现
    "界面报错、后台其实在跑"，用户再点一次就把同一个视频生成两遍。
    """

    def setUp(self):
        ENV.bind()
        ENV.reset_dirs()

    def tearDown(self):
        note_router._inflight_keys.clear()
        note_router._key_by_task.clear()
        note_router._running_tasks.clear()

    def test_generate_note_only_writes_status(self):
        import json as _json

        from fastapi import BackgroundTasks
        from app.services.transcriber_config_manager import TranscriberConfigManager

        constructions = []

        class SpyGenerator:
            def __init__(self):
                constructions.append(1)

        req = note_router.VideoRequest(
            video_url="https://www.bilibili.com/video/BV1PYTD6uEEY",
            platform="bilibili",
            quality="medium",
            model_name="m",
            provider_id="p",
            style="minimal",
        )
        with patch.object(note_router, "NoteGenerator", SpyGenerator), \
                patch.object(TranscriberConfigManager, "is_model_ready",
                             lambda self: {"ready": True, "transcriber_type": "fast-whisper",
                                           "model_size": "tiny", "downloading": False}):
            response = note_router.generate_note(req, BackgroundTasks())

        self.assertEqual(constructions, [], "提交路径构造了 NoteGenerator（会顺带把模型加载进显存）")

        body = _json.loads(response.body)
        self.assertEqual(body["code"], 0)
        task_id = body["data"]["task_id"]
        status_file = ENV.note_dir / f"{task_id}.status.json"
        self.assertTrue(status_file.is_file(), "PENDING 状态文件没写出来，前端轮询会看不到任务")
        self.assertEqual(_json.loads(status_file.read_text(encoding="utf-8"))["status"], "PENDING")
        # 后台任务只是排队，测试里不该真的跑起来
        self.assertNotIn(task_id, note_router._running_tasks)


if __name__ == "__main__":
    unittest.main()
