"""V3.2 后端测试：存储扫描/孤儿截图清理 + FTS5 全文搜索。

只 import app.db / app.services.library_service（不碰 routers，避免拉 fastapi/chromadb），
这样没有 Docker 也能在宿主上用 stub runner 跑。DB 与目录全部由 tests.isolation 指到临时位置。
"""

import json
import os
import pathlib
import sys
import time
import unittest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from tests.isolation import IsolatedEnv  # noqa: E402

ENV = IsolatedEnv("bilinote-storage-test-")

from app.db import library_dao, search_dao  # noqa: E402
from app.db.init_db import init_db  # noqa: E402
from app.services import cleanup_service, library_service  # noqa: E402

NOTE_DIR = ENV.note_dir
SHOT_DIR = ENV.shot_dir

SHOT_A = "screenshot_001_11111111-1111-4111-8111-111111111111.jpg"  # 清单引用
SHOT_B = "screenshot_002_22222222-2222-4222-8222-222222222222.jpg"  # 仅 markdown 正则引用
SHOT_C = "screenshot_003_33333333-3333-4333-8333-333333333333.jpg"  # 孤儿

# 笔记文件名必须是 UUID 形态：生产里 task_id 就是 uuid4，
# 回填/引用扫描的正则只认这种名字，测试不能用 n1/n2 这类短名
NOTE_1 = "aaaaaaaa-0000-4000-8000-000000000001"
NOTE_2 = "aaaaaaaa-0000-4000-8000-000000000002"
# 回填相关用例的笔记：一篇是"库里没有、要新增"，一篇是"库里已有、只缺全文索引"
NOTE_NEW = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
NOTE_LEGACY = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff"
_FTS_IDS = ("s1", "s2", NOTE_NEW, NOTE_LEGACY)

MD = (
    "## 题型一：基期倍比与两期比重差\n"
    "正文正文正文正文正文正文正文正文正文正文正文正文\n"
    f"![](/static/screenshots/{SHOT_B})\n"
    "恩格尔系数变式计算在这里出现一次\n"
)


def _write_note(task_id: str, markdown: str, manifest=None) -> None:
    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "markdown": markdown,
        "transcript": {"segments": []},
        "audio_meta": {"title": "t", "platform": "bilibili", "duration": 60,
                       "cover_url": "", "video_id": "BV1", "raw_info": {}},
    }
    if manifest is not None:
        payload["screenshots"] = manifest
    (NOTE_DIR / f"{task_id}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


class TestSearchIndex(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ENV.bind()
        init_db()
        init_db()  # 再跑一次：建表必须幂等

    def setUp(self):
        ENV.bind()
        for tid in _FTS_IDS:
            search_dao.delete_note(tid)

    def test_rebuild_and_trigram_search(self):
        n = search_dao.rebuild_note("s1", MD)
        self.assertGreaterEqual(n, 1)
        hits = search_dao.search("恩格尔系数")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["task_id"], "s1")
        self.assertEqual(hits[0]["heading"], "题型一：基期倍比与两期比重差")
        # 高亮标记是控制字符 \x01/\x02（前端切分后自己渲染 <mark>，避免把摘要当 HTML 插入）
        self.assertIn("\x01", hits[0]["snippet"])
        self.assertIn("\x02", hits[0]["snippet"])

    def test_short_query_falls_back_to_like(self):
        search_dao.rebuild_note("s1", MD)
        hits = search_dao.search("基期")
        self.assertEqual(len(hits), 1)
        self.assertIn("基期", hits[0]["snippet"])

    def test_no_match_and_empty_query(self):
        search_dao.rebuild_note("s1", MD)
        self.assertEqual(search_dao.search("完全不存在的词串"), [])
        self.assertEqual(search_dao.search(""), [])
        self.assertEqual(search_dao.search('""'), [])  # FTS5 语法字符不能把查询打爆

    def test_rebuild_replaces_old_chunks(self):
        search_dao.rebuild_note("s1", MD)
        # 分块规则要求小节 >= 30 字，太短会被跳过（与 vector_store 行为一致）
        search_dao.rebuild_note("s1", "## 新章节\n" + "换内容换内容换内容换内容换内容换内容换内容换内容\n")
        self.assertEqual(search_dao.search("恩格尔系数"), [])
        self.assertEqual(len(search_dao.search("换内容换内容")), 1)

    def test_delete_note_clears_index(self):
        search_dao.rebuild_note("s1", MD)
        search_dao.delete_note("s1")
        self.assertEqual(search_dao.search("恩格尔系数"), [])


class TestStorageScan(unittest.TestCase):
    def setUp(self):
        ENV.bind()
        ENV.reset_dirs()
        # 用例里的文件都是刚写的，宽限期会让它们全部"太新"而跳过清理；
        # 归零后测的是引用逻辑本身，宽限期单独有 test_recent_files_are_protected
        library_service._ORPHAN_GRACE_MS = 0
        # 别的用例留下的索引行要清掉，否则"恩格尔系数"这种关键词的命中数会串
        for tid in _FTS_IDS:
            search_dao.delete_note(tid)
        for name in (SHOT_A, SHOT_B, SHOT_C):
            (SHOT_DIR / name).write_bytes(b"x" * 100)
        _write_note(NOTE_1, MD, manifest=[SHOT_A])

    def test_scan_classifies_orphans(self):
        scan = library_service.scan_storage()
        self.assertEqual(scan["screenshots"]["count"], 3)
        self.assertEqual(scan["screenshots"]["orphan_count"], 1)
        self.assertEqual(scan["screenshots"]["orphan_bytes"], 100)
        self.assertEqual([o["name"] for o in scan["orphans"]], [SHOT_C])
        # 非截图文件不该被算进去
        (SHOT_DIR / "readme.txt").write_text("hi", encoding="utf-8")
        self.assertEqual(library_service.scan_storage()["screenshots"]["count"], 3)

    def test_delete_orphans_only_touches_unreferenced(self):
        scan = library_service.scan_storage()
        names = [o["name"] for o in scan["orphans"]]
        result = library_service.delete_orphan_screenshots(names + [SHOT_A, "../../etc/passwd"])
        self.assertEqual(result["deleted"], [SHOT_C])
        # 被清单引用的 A、被正则引用的 B、非法名字，都必须还在/被跳过
        self.assertTrue((SHOT_DIR / SHOT_A).exists())
        self.assertTrue((SHOT_DIR / SHOT_B).exists())
        self.assertFalse((SHOT_DIR / SHOT_C).exists())
        self.assertIn(SHOT_A, result["skipped"])
        self.assertIn("../../etc/passwd", result["skipped"])

    def test_delete_rescans_before_acting(self):
        # 扫描之后、删除之前，SHOT_C 被新笔记引用了 → 必须跳过而不是误删
        _write_note(NOTE_2, f"## 新节\n![](/static/screenshots/{SHOT_C})\n" + "正" * 40)
        result = library_service.delete_orphan_screenshots([SHOT_C])
        self.assertEqual(result["deleted"], [])
        self.assertTrue((SHOT_DIR / SHOT_C).exists())

    def test_backfill_rebuilds_search_index(self):
        ENV.reset_dirs()
        _write_note(NOTE_NEW, MD)
        self.assertEqual(library_service.backfill_library(), 1)
        hits = search_dao.search("恩格尔系数")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["task_id"], NOTE_NEW)

    def test_backfill_indexes_notes_already_in_library(self):
        """全文索引上线之前就已经进库的笔记：backfill 不会"新增"它，但必须补建索引，
        否则书架页搜索对这些老笔记永远 0 命中（部署后实测就是这个现象）。"""
        ENV.reset_dirs()
        _write_note(NOTE_LEGACY, MD)
        library_dao.upsert_note(NOTE_LEGACY, status="SUCCESS")
        self.assertEqual(library_service.backfill_library(), 0)  # 库里已有，不算新增
        self.assertEqual([h["task_id"] for h in search_dao.search("恩格尔系数")], [NOTE_LEGACY])

    def test_recent_files_are_protected(self):
        """生成中的笔记：截图先落盘、note json 最后才写，这段窗口不能被当成孤儿删掉。"""
        library_service._ORPHAN_GRACE_MS = 30 * 60 * 1000
        fresh = "screenshot_004_44444444-4444-4444-8444-444444444444.jpg"
        (SHOT_DIR / fresh).write_bytes(b"x" * 100)
        # SHOT_C 确实没人引用，但已经躺了一小时——不在宽限期里，该清
        old = time.time() - 3600
        os.utime(SHOT_DIR / SHOT_C, (old, old))

        names = [o["name"] for o in library_service.scan_storage()["orphans"]]
        self.assertIn(SHOT_C, names)
        self.assertNotIn(fresh, names)

        # 界面上的清单可能是几分钟前扫的，删除时还得再判一次时间
        result = library_service.delete_orphan_screenshots([SHOT_C, fresh])
        self.assertEqual(result["deleted"], [SHOT_C])
        self.assertIn(fresh, result["skipped"])
        self.assertTrue((SHOT_DIR / fresh).exists())

    def test_corrupt_note_json_still_protects_its_screenshots(self):
        """json 坏了不等于这篇笔记不引用截图：整篇跳过会把它引用的图全判成孤儿。"""
        broken = "screenshot_005_55555555-5555-4555-8555-555555555555.jpg"
        (SHOT_DIR / broken).write_bytes(b"x" * 100)
        (NOTE_DIR / f"{NOTE_2}.json").write_text(
            f'{{"markdown": "![](/static/screenshots/{broken})" 这里 json 断掉了',
            encoding="utf-8",
        )
        self.assertNotIn(broken, [o["name"] for o in library_service.scan_storage()["orphans"]])
        self.assertEqual(library_service.delete_orphan_screenshots([broken])["deleted"], [])
        self.assertTrue((SHOT_DIR / broken).exists())


class TestAutoCleanup(unittest.TestCase):
    """自动清理的两条规则（超期 / 超容量）都只作用于孤儿截图。

    被笔记引用的截图不是"靠阈值保住"的，而是压根不进候选集——这条必须有测试钉住，
    因为容量规则算的是孤儿总量，把被引用的大文件算进去就会引发连锁误删。
    """

    USED_OLD = "screenshot_020_aaaaaaaa-0000-4000-8000-00000000aa01.jpg"
    ORPHAN_OLD = "screenshot_021_aaaaaaaa-0000-4000-8000-00000000aa02.jpg"
    ORPHAN_MID = "screenshot_022_aaaaaaaa-0000-4000-8000-00000000aa03.jpg"
    ORPHAN_NEW = "screenshot_023_aaaaaaaa-0000-4000-8000-00000000aa04.jpg"

    def setUp(self):
        ENV.bind()
        ENV.reset_dirs()
        library_service._ORPHAN_GRACE_MS = 0  # 宽限期另有专测，这里要把规则单独验清楚
        for tid in _FTS_IDS:
            search_dao.delete_note(tid)
        _write_note(NOTE_1, f"## 节\n![](/static/screenshots/{self.USED_OLD})\n" + "正" * 40,
                    manifest=[self.USED_OLD])
        for name in (self.USED_OLD, self.ORPHAN_OLD, self.ORPHAN_NEW):
            (SHOT_DIR / name).write_bytes(b"x" * 100)
        self._age(self.USED_OLD, 30)
        self._age(self.ORPHAN_OLD, 30)

    @staticmethod
    def _age(name: str, days: int) -> None:
        old = time.time() - days * 86400
        os.utime(SHOT_DIR / name, (old, old))

    def test_age_rule_only_touches_orphans(self):
        cleanup_service.save_policy({"enabled": True, "keep_days": 14, "max_orphan_mb": 0})
        stats = cleanup_service.run_auto_cleanup("schedule")
        self.assertEqual(stats["aged_deleted"], 1)
        self.assertFalse((SHOT_DIR / self.ORPHAN_OLD).exists())
        self.assertTrue((SHOT_DIR / self.ORPHAN_NEW).exists(), "没超期的孤儿不该被删")
        self.assertTrue((SHOT_DIR / self.USED_OLD).exists(), "被笔记引用的截图绝不能删")

    def test_cap_rule_counts_orphan_bytes_only(self):
        # 3 张 400KB 孤儿 = 1.2MB，上限 1MB → 只需删掉最旧的那张就达标；
        # 另有一张 5MB 的【被引用】截图，若被算进容量会引发连锁误删
        for name in (self.ORPHAN_OLD, self.ORPHAN_MID, self.ORPHAN_NEW):
            (SHOT_DIR / name).write_bytes(b"x" * 400 * 1024)
        (SHOT_DIR / self.USED_OLD).write_bytes(b"x" * 5 * 1024 * 1024)
        self._age(self.ORPHAN_OLD, 30)
        self._age(self.ORPHAN_MID, 10)
        cleanup_service.save_policy({"enabled": True, "keep_days": 0, "max_orphan_mb": 1})

        stats = cleanup_service.run_auto_cleanup("schedule")

        self.assertEqual(stats["deleted"], 1)
        self.assertEqual(stats["over_cap_deleted"], 1)
        self.assertFalse((SHOT_DIR / self.ORPHAN_OLD).exists(), "最旧的孤儿先走")
        self.assertTrue((SHOT_DIR / self.ORPHAN_MID).exists())
        self.assertTrue((SHOT_DIR / self.ORPHAN_NEW).exists())
        self.assertTrue((SHOT_DIR / self.USED_OLD).exists(), "被引用的大图既不计入容量也不许删")
        self.assertLessEqual(stats["remaining_orphan_bytes"], 1024 * 1024)

    def test_switch_off_blocks_schedule_but_not_manual(self):
        cleanup_service.save_policy({"enabled": False, "keep_days": 14, "max_orphan_mb": 0})
        self.assertEqual(cleanup_service.run_auto_cleanup("schedule")["skipped"], "disabled")
        self.assertTrue((SHOT_DIR / self.ORPHAN_OLD).exists())
        # 界面上点"立即清理"是明确意图，不受开关限制
        self.assertEqual(cleanup_service.run_auto_cleanup("manual")["deleted"], 1)
        self.assertFalse((SHOT_DIR / self.ORPHAN_OLD).exists())

    def test_policy_and_last_run_persist_outside_repo(self):
        cleanup_service.save_policy({"keep_days": 7, "max_orphan_mb": 500})
        self.assertEqual(cleanup_service.load_policy()["keep_days"], 7)
        cleanup_service.run_auto_cleanup("manual")
        status = cleanup_service.get_status()
        self.assertEqual(status["policy"]["max_orphan_mb"], 500)
        self.assertEqual(status["last_run"]["reason"], "manual")
        self.assertEqual(status["last_run"]["deleted"], 1)
        # 策略文件必须落在临时目录：写进仓库的 backend/config/ 就是又一次测试污染
        self.assertIn(str(ENV.tmp), cleanup_service.POLICY_PATH)
        self.assertTrue(pathlib.Path(cleanup_service.POLICY_PATH).is_file())


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        ENV.cleanup()
