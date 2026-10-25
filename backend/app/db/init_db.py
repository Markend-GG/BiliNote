from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db.models.video_tasks import VideoTask
from app.db.models.library import Folder, NoteRecord
from app.db.engine import get_engine, Base
from app.utils.logger import get_logger

logger = get_logger(__name__)

def init_db():
    engine = get_engine()

    Base.metadata.create_all(bind=engine)

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
