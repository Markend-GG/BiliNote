from app.db.models.models import Model
from app.db.models.providers import Provider
from app.db.models.video_tasks import VideoTask
from app.db.models.library import Folder, NoteRecord
from app.db.engine import get_engine, Base

def init_db():
    engine = get_engine()

    Base.metadata.create_all(bind=engine)

    # FTS5 是虚拟表，create_all 建不了，单独初始化
    from app.db import search_dao
    search_dao.init_search_table()