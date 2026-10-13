"""V3.2 后端测试：存储扫描/孤儿截图清理 + FTS5 全文搜索。

只 import app.db / app.services.library_service（不碰 routers，避免拉 fastapi/chromadb），
这样没有 Docker 也能在宿主上用 stub runner 跑。DB 与目录全部由 tests.isolation 指到临时位置。
"""

import json
import pathlib
import sys
import unittest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from tests.isolation import IsolatedEnv  # noqa: E402

ENV = IsolatedEnv("bilinote-storage-test-")

from app.db import search_dao  # noqa: E402
from app.db.init_db import init_db  # noqa: E402
from app.services import library_service  # noqa: E402

NOTE_DIR = ENV.note_dir
SHOT_DIR = ENV.shot_dir

SHOT_A = "screenshot_001_11111111-1111-4111-8111-111111111111.jpg"  # 清单引用
SHOT_B = "screenshot_002_22222222-2222-4222-8222-222222222222.jpg"  # 仅 markdown 正则引用
SHOT_C = "screenshot_003_33333333-3333-4333-8333-333333333333.jpg"  # 孤儿

# 笔记文件名必须是 UUID 形态：生产里 task_id 就是 uuid4，
# 回填/引用扫描的正则只认这种名字，测试不能用 n1/n2 这类短名
NOTE_1 = "aaaaaaaa-0000-4000-8000-000000000001"
NOTE_2 = "aaaaaaaa-0000-4000-8000-000000000002"

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
        search_dao.delete_note("s1")
        search_dao.delete_note("s2")

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
        # TestSearchIndex 用完的 s1/s2 索引行要清掉，否则搜索命中数会串
        search_dao.delete_note("s1")
        search_dao.delete_note("s2")
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
        _write_note("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", MD)
        self.assertEqual(library_service.backfill_library(), 1)
        hits = search_dao.search("恩格尔系数")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["task_id"], "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        ENV.cleanup()
