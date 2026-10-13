"""测试隔离：DB / 笔记目录 / 截图目录 / 向量库一律指到临时目录。

为什么要有这么个东西：app.db.engine 在 import 时就把 DATABASE_URL 读死了，而
stub_deps 为了探测缺哪些重依赖必须先 import app。顺序一旦搞反，测试就落到默认值
sqlite:///bili_note.db —— 在仓库里是 backend/bili_note.db，跨运行累积脏数据，
「命中 1 条」这类断言第二次运行必红；在跑着的容器里那更是生产库。

用法（每个测试模块）：

    from tests.isolation import IsolatedEnv
    ENV = IsolatedEnv("bilinote-xxx-test-")   # 模块级：建临时目录 → 设 env → stub → 绑引擎 → 建表

    class T(unittest.TestCase):
        def setUp(self):
            ENV.bind()   # 同进程里别的模块会把全局引擎换成它自己的库，每个用例前抢回来
"""

import atexit
import os
import pathlib
import shutil
import sys
import tempfile

_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tests.stub_deps import install_missing_stubs  # noqa: E402

# 默认库名黑名单：测试连到它说明隔离没生效，宁可当场炸掉
_FORBIDDEN_DB_NAMES = {"bili_note.db"}


class IsolatedEnv:
    def __init__(self, prefix: str):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix=prefix))
        self.db_url = f"sqlite:///{(self.tmp / 'test.db').as_posix()}"
        self.note_dir = self.tmp / "note_results"
        self.shot_dir = self.tmp / "screenshots"
        self.vector_dir = self.tmp / "vector_db"

        os.environ["DATABASE_URL"] = self.db_url
        os.environ["NOTE_OUTPUT_DIR"] = str(self.note_dir)
        os.environ["OUT_DIR"] = str(self.shot_dir)
        os.environ["VECTOR_DB_DIR"] = str(self.vector_dir)

        install_missing_stubs()  # 必须在 env 就位之后：这一步会 import app，引擎在 import 期就绑死

        self._engine = None
        self._dispose_default_engine()
        self.bind()
        self.init_schema()
        # atexit 是 LIFO：先注册删目录、再注册关连接，退出时才会先关连接再删目录
        # （Windows 上连接不关，临时目录删不掉）
        atexit.register(self.cleanup)
        atexit.register(self._dispose)

    def _dispose_default_engine(self) -> None:
        """import app 时按默认值建的那个引擎指向仓库里的 bili_note.db，关掉它。

        只认默认库名，避免误关同进程里别的测试模块的引擎。
        """
        import app.db.engine as db_engine

        try:
            if str(db_engine.engine.url).endswith(tuple(_FORBIDDEN_DB_NAMES)):
                db_engine.engine.dispose()
        except Exception:
            pass

    def _dispose(self) -> None:
        if self._engine is not None:
            self._engine.dispose()

    def bind(self):
        """把全局 engine/SessionLocal 和各模块 import 期读死的路径常量指回本 env。"""
        import app.db.engine as db_engine
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        if pathlib.Path(self.db_url.rsplit("///", 1)[-1]).name in _FORBIDDEN_DB_NAMES:
            raise RuntimeError(f"测试拒绝连接默认库：{self.db_url}")

        os.environ["DATABASE_URL"] = self.db_url
        os.environ["NOTE_OUTPUT_DIR"] = str(self.note_dir)
        os.environ["OUT_DIR"] = str(self.shot_dir)
        os.environ["VECTOR_DB_DIR"] = str(self.vector_dir)

        if db_engine.engine is not self._engine:
            if self._engine is None:
                self._engine = create_engine(
                    self.db_url, connect_args={"check_same_thread": False}
                )
            db_engine.engine = self._engine
            db_engine.SessionLocal = sessionmaker(
                autocommit=False, autoflush=False, bind=self._engine
            )

        from app.services import library_service

        library_service.NOTE_OUTPUT_DIR = str(self.note_dir)
        library_service.IMAGE_OUTPUT_DIR = self.shot_dir
        try:
            from app.services import vector_store

            vector_store.VECTOR_DB_DIR = str(self.vector_dir)
        except Exception:
            # chromadb 不在环境里就跳过：delete_note_artifacts 自己会吞掉向量库异常
            pass
        return self._engine

    def init_schema(self) -> None:
        from app.db.init_db import init_db

        init_db()

    def reset_dirs(self) -> None:
        """清空并重建笔记/截图目录，用例之间不共享盘上残留。"""
        shutil.rmtree(self.note_dir, ignore_errors=True)
        shutil.rmtree(self.shot_dir, ignore_errors=True)
        self.note_dir.mkdir(parents=True, exist_ok=True)
        self.shot_dir.mkdir(parents=True, exist_ok=True)

    def cleanup(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)
