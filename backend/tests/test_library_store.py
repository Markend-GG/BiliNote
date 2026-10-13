"""笔记库（文件夹 + 笔记索引）的数据层与删除逻辑测试。

DB / 笔记目录 / 截图目录 / 向量库全部由 tests.isolation 指到临时位置：
app.db.engine 在 import 期就把 DATABASE_URL 读死了，事后改 os.environ 不可靠，
落到默认值就会写进仓库里的 backend/bili_note.db（在跑着的容器里那更是生产库）。
"""

import json
import pathlib
import sys
import unittest
from datetime import datetime, timezone

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from tests.isolation import IsolatedEnv  # noqa: E402

ENV = IsolatedEnv("bilinote-library-test-")

from app.db.engine import Base, get_engine  # noqa: E402
from app.db import library_dao  # noqa: E402
from app.db.init_db import init_db  # noqa: E402
from app.services import library_service  # noqa: E402

NOTE_DIR = ENV.note_dir
SHOT_DIR = ENV.shot_dir


def _truncate_all() -> None:
    """每个用例从空库开始，避免相互干扰；顺带把全局引擎抢回本模块的临时库。"""
    ENV.bind()
    for table in reversed(Base.metadata.sorted_tables):
        with get_engine().begin() as conn:
            conn.execute(table.delete())


# utils/video_helper.py:22 的命名规则：screenshot_{index:03}_{uuid4}.jpg
SHOT_A = "screenshot_003_11111111-1111-4111-8111-111111111111.jpg"
SHOT_B = "screenshot_004_22222222-2222-4222-8222-222222222222.jpg"


def _write_note(task_id: str, markdown: str, title: str = "某个视频") -> None:
    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    for suffix in (".json", ".status.json", "_audio.json", "_transcript.json", "_markdown.md"):
        (NOTE_DIR / f"{task_id}{suffix}").write_text("{}", encoding="utf-8")
    payload = {
        "markdown": markdown,
        "transcript": {"segments": []},
        "audio_meta": {
            "title": title,
            "cover_url": "http://example.com/cover.jpg",
            "duration": 600.0,
            "platform": "bilibili",
            "video_id": "BV1xx",
        },
    }
    (NOTE_DIR / f"{task_id}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


class TestLibraryDao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ENV.bind()
        init_db()  # 再建一次：建表必须幂等

    def setUp(self):
        _truncate_all()

    def test_folder_crud_and_duplicate_name(self):
        folder = library_dao.create_folder("行测")
        self.assertEqual(folder["name"], "行测")
        self.assertEqual([f["id"] for f in library_dao.list_folders()], [folder["id"]])

        with self.assertRaises(ValueError):
            library_dao.create_folder("行测")
        with self.assertRaises(ValueError):
            library_dao.create_folder("   ")

        renamed = library_dao.rename_folder(folder["id"], "申论")
        self.assertEqual(renamed["name"], "申论")
        self.assertIsNone(library_dao.rename_folder("不存在", "x"))

    def test_upsert_note_only_overwrites_given_fields(self):
        """提交时写 PENDING、成功后补标题封面，第二次不能把第一次的字段冲掉，
        反过来第二次补的标题也不能被后续的状态更新抹掉。"""
        library_dao.upsert_note("t1", status="PENDING", platform="bilibili")
        library_dao.upsert_note("t1", status="SUCCESS", video_title="数量关系专项", cover_url="http://c/1.jpg",
                                duration=6100.0)
        library_dao.upsert_note("t1", status="SUCCESS")

        note = library_dao.get_note("t1")
        self.assertEqual(note["status"], "SUCCESS")
        self.assertEqual(note["platform"], "bilibili")
        self.assertEqual(note["video_title"], "数量关系专项")
        self.assertEqual(note["cover_url"], "http://c/1.jpg")
        self.assertEqual(note["duration"], 6100.0)
        self.assertIsNotNone(note["created_at"])

    def test_datetimes_serialise_as_epoch_ms(self):
        """SQLite 里是 naive UTC，返回 ISO 字符串会被前端 new Date() 当成本地时间解析，
        界面就会差 8 小时（用户已经指出过一次）。必须是 epoch 毫秒。"""
        naive_utc = datetime(2026, 10, 12, 0, 0, 0)
        self.assertEqual(library_dao._ms(naive_utc), 1791763200000)
        self.assertIsNone(library_dao._ms(None))

    def test_move_note(self):
        folder = library_dao.create_folder("行测")
        library_dao.upsert_note("t1", status="SUCCESS")
        self.assertTrue(library_dao.move_note("t1", folder["id"]))
        self.assertEqual(library_dao.get_note("t1")["folder_id"], folder["id"])

        self.assertTrue(library_dao.move_note("t1", None))
        self.assertIsNone(library_dao.get_note("t1")["folder_id"])

        with self.assertRaises(ValueError):
            library_dao.move_note("t1", "不存在的文件夹")
        self.assertFalse(library_dao.move_note("没有这篇", folder["id"]))

    def test_rename_and_touch_note(self):
        library_dao.upsert_note("t1", status="SUCCESS", video_title="原标题")
        self.assertTrue(library_dao.rename_note("t1", "  我的别名  "))
        self.assertEqual(library_dao.get_note("t1")["title"], "我的别名")

        # 清空别名 → 回退到视频标题（title 存 None）
        library_dao.rename_note("t1", "   ")
        self.assertIsNone(library_dao.get_note("t1")["title"])

        self.assertIsNone(library_dao.get_note("t1")["last_opened_at"])
        self.assertTrue(library_dao.touch_note("t1"))
        self.assertIsNotNone(library_dao.get_note("t1")["last_opened_at"])

    def test_form_data_round_trip(self):
        """「重新生成」要靠这份快照恢复原来的链接/风格/模型，存进去取出来必须一模一样。"""
        payload = {"video_url": "https://www.bilibili.com/video/BV1xx", "style": "xingce_course",
                   "grid_size": [3, 3], "quality": "medium"}
        library_dao.upsert_note("t1", status="PENDING", form_data=payload)
        self.assertEqual(library_dao.get_note("t1")["form_data"], payload)

        # 成功后只更新状态，不能把快照冲掉
        library_dao.upsert_note("t1", status="SUCCESS", video_title="标题")
        note = library_dao.get_note("t1")
        self.assertEqual(note["form_data"], payload)
        self.assertEqual(note["status"], "SUCCESS")

    def test_form_data_tolerates_garbage(self):
        library_dao.upsert_note("t1", status="SUCCESS", form_data="这不是 json")
        self.assertIsNone(library_dao.get_note("t1")["form_data"])

    def test_delete_folder_move_keeps_notes(self):
        folder = library_dao.create_folder("行测")
        library_dao.upsert_note("t1", status="SUCCESS", folder_id=folder["id"])
        library_dao.upsert_note("t2", status="SUCCESS", folder_id=folder["id"])

        affected = library_dao.delete_folder(folder["id"], "move")

        self.assertEqual(affected, [])
        self.assertEqual(library_dao.list_folders(), [])
        self.assertIsNone(library_dao.get_note("t1")["folder_id"])
        self.assertIsNotNone(library_dao.get_note("t2"))

    def test_delete_folder_delete_removes_note_rows(self):
        folder = library_dao.create_folder("行测")
        library_dao.upsert_note("t1", status="SUCCESS", folder_id=folder["id"])
        library_dao.upsert_note("t2", status="SUCCESS")  # 未分类，不该被牵连

        affected = library_dao.delete_folder(folder["id"], "delete")

        self.assertEqual(affected, ["t1"])
        self.assertIsNone(library_dao.get_note("t1"))
        self.assertIsNotNone(library_dao.get_note("t2"))


class TestDeleteNoteArtifacts(unittest.TestCase):
    def setUp(self):
        ENV.bind()
        ENV.reset_dirs()
        _truncate_all()

    def test_deletes_files_and_only_referenced_screenshots(self):
        """delete_task 以前是空壳，界面删了盘上什么都没少。
        截图目录是全局扁平的，只能靠 markdown 里的引用反查归属，绝不能整目录清。"""
        (SHOT_DIR / SHOT_A).write_bytes(b"a")
        (SHOT_DIR / SHOT_B).write_bytes(b"b")
        _write_note("t1", f"# 标题\n\n![](/static/screenshots/{SHOT_A})\n")
        library_dao.upsert_note("t1", status="SUCCESS")

        result = library_service.delete_note_artifacts("t1")

        self.assertEqual(result["deleted_files"], 5)
        self.assertEqual(result["deleted_screenshots"], 1)
        self.assertEqual(list(NOTE_DIR.glob("t1*")), [])
        self.assertFalse((SHOT_DIR / SHOT_A).exists())
        self.assertTrue((SHOT_DIR / SHOT_B).exists(), "别的笔记的截图被误删了")
        self.assertIsNone(library_dao.get_note("t1"))

    def test_tolerates_missing_note(self):
        result = library_service.delete_note_artifacts("根本不存在的任务")
        self.assertEqual(result, {"deleted_files": 0, "deleted_screenshots": 0})

    def test_unreadable_json_still_deletes_files(self):
        NOTE_DIR.mkdir(parents=True, exist_ok=True)
        for suffix in (".json", ".status.json"):
            (NOTE_DIR / f"t2{suffix}").write_text("{}", encoding="utf-8")
        (NOTE_DIR / "t2.json").write_text("这不是 json", encoding="utf-8")

        result = library_service.delete_note_artifacts("t2")

        self.assertEqual(result["deleted_files"], 2)
        self.assertEqual(result["deleted_screenshots"], 0)


class TestBackfill(unittest.TestCase):
    def setUp(self):
        ENV.bind()
        ENV.reset_dirs()
        _truncate_all()

    def test_backfills_existing_notes_and_is_idempotent(self):
        _write_note("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "# 笔记", title="数量关系专项")
        # 派生缓存文件名带下划线，不该被当成一篇笔记
        (NOTE_DIR / "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee_transcript.json").write_text("{}", encoding="utf-8")

        self.assertEqual(library_service.backfill_library(), 1)
        note = library_dao.get_note("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
        self.assertEqual(note["video_title"], "数量关系专项")
        self.assertEqual(note["status"], "SUCCESS")
        self.assertEqual(note["platform"], "bilibili")
        self.assertEqual(note["duration"], 600.0)

        # 再跑一次不该重复插入，也不该覆盖用户后来改过的别名
        library_dao.rename_note("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "我的别名")
        self.assertEqual(library_service.backfill_library(), 0)
        self.assertEqual(library_dao.get_note("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")["title"], "我的别名")

    def test_skips_unreadable_file(self):
        (NOTE_DIR / "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff.json").write_text("坏文件", encoding="utf-8")
        self.assertEqual(library_service.backfill_library(), 0)
        self.assertEqual(library_dao.list_notes(), [])


class TestNoteVersions(unittest.TestCase):
    def setUp(self):
        _truncate_all()

    def test_add_list_delete_version(self):
        first = library_dao.add_version("t1", "t1-v1", "内容一", style="minimal", model_name="m",
                                        created_at_ms=1791763200000)
        library_dao.add_version("t1", "t1-v2", "内容二", created_at_ms=1791763260000)
        self.assertEqual(first["created_at"], 1791763200000)

        versions = library_dao.list_versions("t1")
        # 新在前，与前端旧版本地数组顺序一致
        self.assertEqual([v["ver_id"] for v in versions], ["t1-v2", "t1-v1"])
        self.assertEqual(library_dao.latest_version("t1")["ver_id"], "t1-v2")

        self.assertTrue(library_dao.delete_version("t1", "t1-v2"))
        self.assertFalse(library_dao.delete_version("t1", "t1-v2"))
        self.assertEqual([v["ver_id"] for v in library_dao.list_versions("t1")], ["t1-v1"])

    def test_add_version_is_idempotent_by_ver_id(self):
        library_dao.add_version("t1", "t1-v1", "内容一")
        library_dao.add_version("t1", "t1-v1", "内容被改了吗")
        self.assertEqual(len(library_dao.list_versions("t1")), 1)
        self.assertEqual(library_dao.list_versions("t1")[0]["content"], "内容一")

    def test_sync_versions_only_fills_missing(self):
        library_dao.add_version("t1", "t1-v1", "已有")
        added = library_dao.sync_versions("t1", [
            {"ver_id": "t1-v1", "content": "已有"},
            {"ver_id": "t1-v0", "content": "浏览器存量", "created_at_ms": 1791763100000},
            {"ver_id": "", "content": "坏数据"},
            {"ver_id": "t1-x", "content": ""},
        ])
        self.assertEqual(added, 1)
        ids = [v["ver_id"] for v in library_dao.list_versions("t1")]
        self.assertEqual(sorted(ids), ["t1-v0", "t1-v1"])

    def test_deleting_note_cascades_versions(self):
        library_dao.upsert_note("t1", status="SUCCESS")
        library_dao.add_version("t1", "t1-v1", "内容")
        library_dao.delete_note_row("t1")
        self.assertEqual(library_dao.list_versions("t1"), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
