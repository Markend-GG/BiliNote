"""笔记正文的 SQLite FTS5 全文索引。

书架页搜索原来只搜标题；这里对正文按 H2/H3 分块建 FTS5 索引，支持中文子串命中
（trigram 分词器，需 SQLite >= 3.34；容器里 3.11 自带的版本满足）。
查询串整体当短语匹配并做引号转义，避免用户输入 FTS5 语法字符报错；
不足 3 个字符（trigram 的下限）时退化为 LIKE 扫表——索引总量只有几百行，扫得起。
"""

from app.db.engine import get_engine  # 每次调用取全局引擎：import 期绑死会让测试没法换库
from app.utils.logger import get_logger
from app.utils.markdown_chunks import chunk_markdown

logger = get_logger(__name__)

_TABLE = "note_fts"


def init_search_table() -> None:
    """建 FTS5 虚拟表。create_all 建不了虚拟表，所以单独用原生 SQL；已存在则跳过。"""
    with get_engine().begin() as conn:
        row = conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (_TABLE,)
        ).fetchone()
        if row:
            return
        conn.exec_driver_sql(
            f"CREATE VIRTUAL TABLE {_TABLE} USING fts5("
            "task_id UNINDEXED, heading UNINDEXED, text, tokenize='trigram')"
        )
        logger.info("已创建全文索引表 note_fts")


def rebuild_note(task_id: str, markdown: str) -> int:
    """重建一篇笔记的索引块，返回块数。生成成功/编辑保存/启动回填时调用。"""
    chunks = chunk_markdown(markdown or "")
    with get_engine().begin() as conn:
        conn.exec_driver_sql(f"DELETE FROM {_TABLE} WHERE task_id = ?", (task_id,))
        for chunk in chunks:
            conn.exec_driver_sql(
                f"INSERT INTO {_TABLE}(task_id, heading, text) VALUES (?, ?, ?)",
                (task_id, chunk["metadata"].get("section_title", ""), chunk["text"]),
            )
    return len(chunks)


def delete_note(task_id: str) -> None:
    with get_engine().begin() as conn:
        conn.exec_driver_sql(f"DELETE FROM {_TABLE} WHERE task_id = ?", (task_id,))


def count_note(task_id: str) -> int:
    """这篇笔记有几个索引块。启动回填靠它判断存量笔记要不要补建索引。"""
    with get_engine().connect() as conn:
        row = conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM {_TABLE} WHERE task_id = ?", (task_id,)
        ).fetchone()
    return int(row[0]) if row else 0


def search(query: str, limit: int = 30) -> list[dict]:
    q = (query or "").strip()
    if not q:
        return []
    with get_engine().connect() as conn:
        if len(q) >= 3:
            expr = '"' + q.replace('"', '""') + '"'
            # 高亮标记用控制字符而不是 <mark>：snippet 里是笔记原文，
            # 直接塞 HTML 标签再交给前端 innerHTML 就是 XSS 通道；前端按控制字符切分后自己渲染 <mark>
            rows = conn.exec_driver_sql(
                f"SELECT task_id, heading, snippet({_TABLE}, 2, '\x01', '\x02', '…', 18) "
                f"FROM {_TABLE} WHERE {_TABLE} MATCH ? ORDER BY rank LIMIT ?",
                (expr, limit),
            ).fetchall()
        else:
            rows = conn.exec_driver_sql(
                f"SELECT task_id, heading, text FROM {_TABLE} WHERE text LIKE ? LIMIT ?",
                (f"%{q}%", limit),
            ).fetchall()
    return [
        {
            "task_id": row[0],
            "heading": row[1],
            # LIKE 分支没有 snippet()，直接截一段原文当摘要
            "snippet": row[2] if len(q) >= 3 else _rough_snippet(row[2], q),
        }
        for row in rows
    ]


def _rough_snippet(text: str, q: str, width: int = 90) -> str:
    idx = text.find(q)
    if idx < 0:
        return text[:width]
    start = max(0, idx - width // 3)
    return ("…" if start else "") + text[start:start + width] + "…"
