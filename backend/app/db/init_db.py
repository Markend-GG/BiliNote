from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db.models.video_tasks import VideoTask
from app.db.models.library import Folder, NoteRecord
from app.db.engine import get_engine, Base
from app.utils.logger import get_logger

logger = get_logger(__name__)

def _migrate_note_sort_order(engine) -> None:
    """notes 表补 sort_order 列（手动排序档用）。

    仓库没有 alembic，而 create_all 对【已存在】的表不会补列，所以照 search_dao 的
    幂等裸 SQL 路子：PRAGMA 查列，缺才 ALTER。老笔记按"文件夹内创建时间正序"回填，
    这样手动排序档第一次打开就是用户熟悉的时间顺序，而不是全 0 的随机序。
    """
    with engine.connect() as conn:
        cols = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(notes)").fetchall()]
        if "sort_order" in cols:
            return
        conn.exec_driver_sql("ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        conn.exec_driver_sql(
            "UPDATE notes SET sort_order = ("
            "  SELECT COUNT(*) FROM notes AS o"
            "   WHERE o.folder_id IS notes.folder_id"
            "     AND (o.created_at < notes.created_at"
            "          OR (o.created_at = notes.created_at AND o.task_id <= notes.task_id))"
            ") - 1"
        )
        conn.commit()
    logger.info("notes 表已补 sort_order 列，并按文件夹内创建顺序回填")


def init_db():
    engine = get_engine()

    Base.metadata.create_all(bind=engine)
    _migrate_note_sort_order(engine)

    # WAL：读写并发。默认的 rollback journal 模式下，生成笔记的写事务会把界面的
    # 读请求整段堵住（实测堵出过 "database is locked"）；WAL 下读者不阻塞写者。
    # 个别文件系统不支持 WAL，失败就保持默认模式，不影响启动。
    if engine.dialect.name == "sqlite":
        try:
            with engine.connect() as conn:
                mode = conn.exec_driver_sql("PRAGMA journal_mode=WAL").scalar()
                conn.commit()
            logger.info(f"SQLite journal_mode={mode}")
        except Exception as e:
            logger.warning(f"启用 WAL 失败，保持默认日志模式: {e}")

    # FTS5 是虚拟表，create_all 建不了，单独初始化
    from app.db import search_dao
    search_dao.init_search_table()
