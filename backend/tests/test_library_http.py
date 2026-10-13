"""library / storage / search / delete_task 的 HTTP 层测试（FastAPI TestClient）。

DAO/service 层已有 test_library_store / test_storage_search 覆盖；这里钉的是接口形状：
状态码包装、错误码、删除真的落盘。运行环境需要 fastapi+httpx（容器镜像里有）。
"""

import json
import os
import pathlib
import sys
import tempfile
import unittest
import uuid
from contextlib import asynccontextmanager

_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="bilinote-http-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["NOTE_OUTPUT_DIR"] = (_TMP / "note_results").as_posix()
os.environ["OUT_DIR"] = (_TMP / "screenshots").as_posix()
os.environ["VECTOR_DB_DIR"] = (_TMP / "vector_db").as_posix()

from fastapi.testclient import TestClient  # noqa: E402

from app import create_app  # noqa: E402
from app.db import search_dao  # noqa: E402
from app.db.init_db import init_db  # noqa: E402


@asynccontextmanager
async def _noop_lifespan(_app):
    yield


init_db()
client = TestClient(create_app(lifespan=_noop_lifespan))

NOTE_DIR = pathlib.Path(os.environ["NOTE_OUTPUT_DIR"])
SHOT_DIR = pathlib.Path(os.environ["OUT_DIR"])


def _make_note(task_id: str, markdown: str, shots=()) -> None:
    NOTE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "markdown": markdown,
        "transcript": {"segments": []},
        "audio_meta": {"title": "http-test-note", "platform": "bilibili", "duration": 60,
                       "cover_url": "", "video_id": "BVhttp", "raw_info": {}},
        "screenshots": list(shots),
    }
    for suffix in (".json", ".status.json", "_audio.json", "_transcript.json", "_markdown.md"):
        (NOTE_DIR / f"{task_id}{suffix}").write_text(
            json.dumps(payload, ensure_ascii=False) if suffix == ".json" else "{}", encoding="utf-8"
        )


class TestLibraryHttp(unittest.TestCase):
    def test_library_shape(self):
        res = client.get("/api/library").json()
        self.assertEqual(res["code"], 0)
        self.assertIn("folders", res["data"])
        self.assertIn("notes", res["data"])

    def test_folder_create_duplicate_and_delete(self):
        created = client.post("/api/library/folder", json={"name": "http夹"}).json()
        self.assertEqual(created["code"], 0)
        folder_id = created["data"]["id"]

        dup = client.post("/api/library/folder", json={"name": "http夹"}).json()
        self.assertNotEqual(dup["code"], 0)

        gone = client.delete(f"/api/library/folder/{folder_id}", params={"mode": "move"}).json()
        self.assertEqual(gone["code"], 0)
        self.assertEqual(client.get("/api/library").json()["data"]["folders"], [])

    def test_move_unknown_note_is_error(self):
        res = client.post("/api/library/move", json={"task_id": "nope", "folder_id": None}).json()
        self.assertNotEqual(res["code"], 0)

    def test_versions_sync_list_delete(self):
        task_id = str(uuid.uuid4())
        sync = client.post("/api/library/versions/sync", json={
            "task_id": task_id,
            "versions": [
                {"ver_id": f"{task_id}-v1", "content": "一", "created_at": 1791763200000},
                {"ver_id": f"{task_id}-v2", "content": "二", "created_at": 1791763260000},
            ],
        }).json()
        self.assertEqual(sync["data"]["added"], 2)

        # 重复同步不重复插入
        again = client.post("/api/library/versions/sync", json={
            "task_id": task_id,
            "versions": [{"ver_id": f"{task_id}-v1", "content": "一"}],
        }).json()
        self.assertEqual(again["data"]["added"], 0)

        listed = client.get(f"/api/library/versions/{task_id}").json()["data"]
        self.assertEqual([v["ver_id"] for v in listed], [f"{task_id}-v2", f"{task_id}-v1"])

        deleted = client.delete(f"/api/library/versions/{task_id}/{task_id}-v2").json()
        self.assertEqual(deleted["code"], 0)
        listed = client.get(f"/api/library/versions/{task_id}").json()["data"]
        self.assertEqual(len(listed), 1)

    def test_delete_task_really_deletes(self):
        task_id = str(uuid.uuid4())
        shot = f"screenshot_007_{uuid.uuid4()}.jpg"
        SHOT_DIR.mkdir(parents=True, exist_ok=True)
        (SHOT_DIR / shot).write_bytes(b"z" * 10)
        _make_note(task_id, f"## 节\n![](/static/screenshots/{shot})\n", shots=[shot])

        res = client.post("/api/delete_task", json={"task_id": task_id}).json()
        self.assertEqual(res["code"], 0)
        self.assertEqual(res["data"]["deleted_files"], 5)
        self.assertEqual(res["data"]["deleted_screenshots"], 1)
        self.assertFalse((NOTE_DIR / f"{task_id}.json").exists())
        self.assertFalse((SHOT_DIR / shot).exists())

    def test_storage_scan_and_delete_guard(self):
        orphan = f"screenshot_008_{uuid.uuid4()}.jpg"
        used = f"screenshot_009_{uuid.uuid4()}.jpg"
        task_id = str(uuid.uuid4())
        SHOT_DIR.mkdir(parents=True, exist_ok=True)
        for name in (orphan, used):
            (SHOT_DIR / name).write_bytes(b"z" * 10)
        _make_note(task_id, f"## 节\n![](/static/screenshots/{used})\n", shots=[used])

        scan = client.get("/api/storage/scan").json()["data"]
        names = [o["name"] for o in scan["orphans"]]
        self.assertIn(orphan, names)
        self.assertNotIn(used, names)

        res = client.post("/api/storage/delete", json={"names": [orphan, used, "../escape.jpg"]}).json()
        self.assertEqual(res["data"]["deleted"], [orphan])
        self.assertIn(used, res["data"]["skipped"])
        self.assertIn("../escape.jpg", res["data"]["skipped"])
        self.assertTrue((SHOT_DIR / used).exists())
        self.assertFalse((SHOT_DIR / orphan).exists())

    def test_search_endpoint(self):
        task_id = str(uuid.uuid4())
        _make_note(task_id, "## 搜索章节\n恩格尔系数变式计算出现在这里足够长的正文正文正文\n")
        search_dao.rebuild_note(task_id, "## 搜索章节\n恩格尔系数变式计算出现在这里足够长的正文正文正文\n")
        res = client.get("/api/search", params={"q": "恩格尔系数"}).json()
        self.assertEqual(res["code"], 0)
        self.assertTrue(any(h["task_id"] == task_id for h in res["data"]))
        hit = next(h for h in res["data"] if h["task_id"] == task_id)
        self.assertEqual(hit["heading"], "搜索章节")
        self.assertEqual(hit["title"], "http-test-note")


if __name__ == "__main__":
    unittest.main(verbosity=2)
