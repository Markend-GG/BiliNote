from sqlalchemy import Column, DateTime, Float, Integer, String, Text, func
from sqlalchemy.schema import Index

from app.db.engine import Base


class Folder(Base):
    __tablename__ = "folders"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class NoteRecord(Base):
    """笔记库索引。

    笔记正文仍然以 note_results/{task_id}.json 扁平存放——task_id 同时是 5 个缓存文件名、
    ChromaDB collection 名、抽帧目录前缀，真按文件夹建子目录会连坐一大片路径反解逻辑。
    所以文件夹只是这里的一列元数据。
    """

    __tablename__ = "notes"

    task_id = Column(String, primary_key=True)
    # 用户自定义别名；为空时前端回退到 video_title
    title = Column(String, nullable=True)
    video_title = Column(String, nullable=True)
    # null = 未分类。不建外键级联，删文件夹时由 DAO 显式置空或连带删笔记
    folder_id = Column(String, nullable=True)
    status = Column(String, nullable=True)
    video_id = Column(String, nullable=True)
    platform = Column(String, nullable=True)
    cover_url = Column(String, nullable=True)
    duration = Column(Float, nullable=True)
    created_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=True)
    last_opened_at = Column(DateTime, nullable=True)
    # 生成这篇笔记时的表单参数（JSON 文本）。详情页刷新后若浏览器本地记录已丢，
    # 「重新生成」还得知道原来的链接/风格/模型，只能从这里恢复。
    form_data = Column(Text, nullable=True)


class NoteVersion(Base):
    """笔记版本历史。

    以前版本只存在浏览器 IndexedDB 里：清一次缓存、换一台电脑，就只剩最新一版。
    现在后端是权威存储，浏览器那份退化为缓存。
    """

    __tablename__ = "note_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String, nullable=False)
    ver_id = Column(String, nullable=False, unique=True)
    content = Column(Text, nullable=False)
    style = Column(String, nullable=True)
    model_name = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_note_versions_task_id", "task_id"),)
