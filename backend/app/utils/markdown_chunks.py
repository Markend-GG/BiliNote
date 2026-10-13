"""把笔记 markdown 切成检索块。

原来这份逻辑只在 services/vector_store.py 里（给 ChromaDB 用），但那个模块顶部 import chromadb，
FTS5 全文搜索只想复用分块规则、不想背上 chromadb 依赖，所以抽到这里两边共用。
"""

import re


def chunk_markdown(markdown: str) -> list[dict]:
    """按 H2/H3 标题拆分 markdown 为语义块。"""
    sections = re.split(r'(?=^#{2,3}\s)', markdown, flags=re.MULTILINE)
    chunks = []
    for section in sections:
        section = section.strip()
        if not section or len(section) < 30:
            continue
        heading_match = re.match(r'^(#{2,3})\s+(.+)', section)
        title = heading_match.group(2).strip() if heading_match else "intro"
        chunks.append({
            "text": section,
            "metadata": {"source_type": "markdown", "section_title": title},
        })
    return chunks
