"""笔记库（文件夹 + 笔记索引）的数据层与删除逻辑测试。

app.db.engine / app.services.library_service / app.services.vector_store 都在 import 时读环境变量。
但 unittest discover 会先把所有测试模块导入一遍，别的模块很可能已经用默认值把这几个模块导入过了，
所以光设 os.environ 不够——必须在导入之后把模块里的常量直接改指到临时目录，
否则会往真实的 bili_note.db 和 note_results/ 里写。
"""

import atexit
import json
import pathlib
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="bilinote-library-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["NOTE_OUTPUT_DIR"] = (_TMP / "note_results").as_posix()
os.environ["OUT_DIR"] = (_TMP / "screenshots").as_posix()
os.environ["VECTOR_DB_DIR"] = (_TMP / "vector_db").as_posix()

import app.db.engine as db_engine  # noqa: E402

# 把全局 engine / SessionLocal 换成测试库：library_dao 与 video_task_dao 都是
# 通过 app.db.engine.get_db() 拿会话，而 get_db 在调用时才查模块全局 SessionLocal。
_TEST_ENGINE = create_engine(os.environ["DATABASE_URL"], connect_args={"check_same_thread": False})
db_engine.engine = _TEST_ENGINE
db_engine.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_TEST_ENGINE)

from app.db.engine import Base, get_engine  # noqa: E402
from app.db import library_dao  # noqa: E402
from app.db.init_db import init_db  # noqa: E402
from app.services import library_service  # noqa: E402

NOTE_DIR = pathlib.Path(os.environ["NOTE_OUTPUT_DIR"])
SHOT_DIR = pathlib.Path(os.environ["OUT_DIR"])

library_service.NOTE_OUTPUT_DIR = str(NOTE_DIR)
library_service.IMAGE_OUTPUT_DIR = SHOT_DIR

# 删笔记时会顺带删向量索引；不指到临时目录就会去动真实的 vector_db
try:
    from app.services import vector_store as _vector_store

    _vector_store.VECTOR_DB_DIR = os.environ["VECTOR_DB_DIR"]
except Exception:  # chromadb 不在环境里时跳过，delete_note_artifacts 自己会吞掉异常
    pass

init_db()
atexit.register(shutil.rmtree, _TMP, True)

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
        init_db()

    def setUp(self):
        # 每个用例从空库开始，避免相互干扰
        engine = get_engine()
        for table in reversed(Base.metadata.sorted_tables):
            with engine.begin() as conn:
                conn.execute(table.delete())

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
        shutil.rmtree(NOTE_DIR, ignore_errors=True)
        shutil.rmtree(SHOT_DIR, ignore_errors=True)
        NOTE_DIR.mkdir(parents=True, exist_ok=True)
        SHOT_DIR.mkdir(parents=True, exist_ok=True)
        engine = get_engine()
        for table in reversed(Base.metadata.sorted_tables):
            with engine.begin() as conn:
                conn.execute(table.delete())

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
        shutil.rmtree(NOTE_DIR, ignore_errors=True)
        NOTE_DIR.mkdir(parents=True, exist_ok=True)
        engine = get_engine()
        for table in reversed(Base.metadata.sorted_tables):
            with engine.begin() as conn:
                conn.execute(table.delete())

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
