"""把笔记里的「目录」条目补成能点击的锚点链接。

前端用 rehype-slug（github-slugger）给标题生成 id，规则是：转小写 → 删掉所有标点/符号/控制符
（`-` 和 `_` 保留）→ 空格换成 `-`，同名标题依次加 `-1`、`-2` 后缀。模型自己写的锚点经常对不上
（甚至只写纯文本列表），所以这里按同一套规则重算，保证目录点了能跳。
"""
import re
import unicodedata
from typing import Dict, List, Optional, Tuple

HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
LIST_ITEM_PATTERN = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
# 目录条目里可能嵌着（甚至多层嵌套的）链接，逐层剥成纯文本
INNER_LINK_PATTERN = re.compile(r"\[([^\[\]]*)\]\([^)]*\)")
# 模型有时把「原片 @ mm:ss」胶囊文字也抄进目录标签里
ORIGIN_PILL_PATTERN = re.compile(r"原片\s*@?\s*\d{1,3}:\d{2}")
EXAMPLE_HEADING_PATTERN = re.compile(r"^例题\s*\d")
TOC_TITLES = ("目录", "大纲", "contents", "table of contents", "toc")
# 目录都写在开头，限制搜索范围，避免把正文里叫「目录结构」的章节误认成目录
TOC_SEARCH_LINES = 40

# 下面两张表是把 github-slugger 1.5.0 的删除规则在 BMP 全量码点上逐一对拍后得到的差异修正：
# Unicode 类别规则漏掉的部分——各类空白（不换行/全角/窄空格）、带圈数字 ①②③、上标下标与
# 分数字符等要额外删除；下划线类连接符（含全角）要额外保留。加上这两张表后 BMP 内零差异。
_EXTRA_REMOVED_RE = re.compile(
    "[\u00a0\u00b2-\u00b3\u00b9\u00bc-\u00be\u0870-\u0887\u0889-\u088e\u0898-\u089f\u08b5"
    "\u08c8-\u08d2\u09f4-\u09f9\u0b72-\u0b77\u0bf0-\u0bf2\u0c3c\u0c5d\u0c78-\u0c7e\u0cdd\u0cf3"
    "\u0d58-\u0d5e\u0d70-\u0d78\u0ece\u0f2a-\u0f33\u1369-\u137c\u1680\u170d\u1715\u171f"
    "\u17f0-\u17f9\u180f\u19da\u1ac1-\u1ace\u1b4c\u1dfa\u2000-\u200a\u2028-\u2029\u202f\u205f"
    "\u2070\u2074-\u2079\u2080-\u2089\u2150-\u215f\u2189\u2460-\u249b\u24ea-\u24ff"
    "\u2776-\u2793\u2c2f\u2c5f\u2cfd\u3000\u3192-\u3195\u3220-\u3229\u3248-\u324f\u3251-\u325f"
    "\u3280-\u3289\u32b1-\u32bf\u9ffd-\u9fff\ua7c0-\ua7c1\ua7d0-\ua7d1\ua7d3\ua7d5-\ua7d9"
    "\ua7f2-\ua7f4\ua830-\ua835]"
)
_EXTRA_KEPT_RE = re.compile("[\u203f-\u2040\u2054\u24b6-\u24e9\ua7cb\ua7dc\ufe33-\ufe34\ufe4d-\ufe4f\uff3f]")


def github_slug(text: str) -> str:
    """复刻 github-slugger 的 slug 规则，结果与前端 rehype-slug 生成的标题 id 一致。"""
    kept: List[str] = []
    for char in text.lower():
        if char == " ":
            kept.append("-")
        elif _is_removed(char):
            continue
        else:
            kept.append(char)
    return "".join(kept)


def _is_removed(char: str) -> bool:
    if char in "-_" or _EXTRA_KEPT_RE.match(char):
        return False
    if _EXTRA_REMOVED_RE.match(char):
        return True
    # 标点(P)、符号(S)、控制符与未分配码点(C) 一律删除
    return unicodedata.category(char)[0] in "PSC"


def collect_heading_slugs(markdown: str) -> List[Tuple[int, str, str]]:
    """按文档顺序返回 [(层级, 标题文本, 前端会生成的 id)]。"""
    occurrences: Dict[str, int] = {}
    headings: List[Tuple[int, str, str]] = []
    in_code_block = False
    for line in markdown.split("\n"):
        if line.lstrip().startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        match = HEADING_PATTERN.match(line)
        if not match:
            continue
        text = match.group(2).strip()
        base = github_slug(text)
        slug = base
        while slug in occurrences:
            occurrences[base] = occurrences.get(base, 0) + 1
            slug = f"{base}-{occurrences[base]}"
        occurrences[slug] = 0
        headings.append((len(match.group(1)), text, slug))
    return headings


def linkify_toc(markdown: str) -> str:
    """把目录里的条目改写成干净的单行 `- [标题](#锚点)`。

    模型经常把目录条目写坏：标签里嵌着原片跳转链接、标签跨多行、锚点算错。
    这里一律剥成纯文本后按标题重新匹配，并用**标题自己的文字**重写条目，
    匹配不上的条目原样保留。
    """
    lines = markdown.split("\n")
    headings = collect_heading_slugs(markdown)
    toc_start, toc_level = _find_toc_heading(lines)
    if toc_start is None:
        return markdown

    out: List[str] = lines[: toc_start + 1]
    changed = False
    i = toc_start + 1
    while i < len(lines):
        line = lines[i]
        heading = HEADING_PATTERN.match(line)
        if heading and len(heading.group(1)) <= toc_level:
            out.extend(lines[i:])
            break
        item = LIST_ITEM_PATTERN.match(line)
        if not item:
            out.append(line)
            i += 1
            continue
        indent, bullet, content = item.groups()
        raw, i = _read_list_item(lines, i)
        # 只拿列表项内容去匹配（带上 "- " 会让 slug 多出一个横线，匹配不上）
        joined = " ".join([content.strip()] + [x.strip() for x in raw[1:]])
        matched = _match_heading(_plain_label(joined), headings)
        if matched:
            text, slug = matched
            new_line = f"{indent}{bullet} [{text}](#{slug})"
            out.append(new_line)
            changed = changed or new_line != " ".join(raw)
        else:
            out.extend(raw)

    return "\n".join(out) if changed else markdown


def nest_example_headings(markdown: str) -> str:
    """把「例题N」压到它前面那个标题的下一级（解法/题型都行），连续的例题保持同级。

    模型常把解法和例题写成同级标题，折叠时例题就不在解法里面，目录里也看不出从属关系。
    """
    out: List[str] = []
    in_code_block = False
    prev_level = 0
    prev_is_example = False
    for line in markdown.split("\n"):
        if line.lstrip().startswith("```"):
            in_code_block = not in_code_block
            out.append(line)
            continue
        match = None if in_code_block else HEADING_PATTERN.match(line)
        if not match:
            out.append(line)
            continue
        level = len(match.group(1))
        text = match.group(2).strip()
        if EXAMPLE_HEADING_PATTERN.match(text):
            # 紧跟上一道例题 → 同级（同一个解法下的兄弟）；否则压到前一个标题下面一级
            level = prev_level if prev_is_example else min(6, prev_level + 1)
        out.append("#" * level + " " + text)
        prev_level = level
        prev_is_example = bool(EXAMPLE_HEADING_PATTERN.match(text))
    return "\n".join(out)


def _read_list_item(lines: List[str], start: int) -> Tuple[List[str], int]:
    """列表项可能跨多行（模型把链接标签写成多行），按括号配平把整项收回来。"""
    raw = [lines[start]]
    j = start + 1
    while j < len(lines) and _is_unbalanced(" ".join(raw)):
        raw.append(lines[j])
        j += 1
    return raw, j


def _is_unbalanced(text: str) -> bool:
    return text.count("[") > text.count("]") or text.count("(") > text.count(")")


def _plain_label(content: str) -> str:
    """把目录条目剥成纯文本：去掉（可能嵌套的）链接语法和原片时间胶囊文字。"""
    text = content
    for _ in range(3):
        stripped = INNER_LINK_PATTERN.sub(r"\1", text)
        if stripped == text:
            break
        text = stripped
    text = ORIGIN_PILL_PATTERN.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def _find_toc_heading(lines: List[str]) -> Tuple[Optional[int], int]:
    in_code_block = False
    for i, line in enumerate(lines[:TOC_SEARCH_LINES]):
        if line.lstrip().startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue
        match = HEADING_PATTERN.match(line)
        if not match:
            continue
        text = match.group(2).strip().lower()
        if text not in TOC_TITLES and not text.startswith("目录"):
            continue
        # 还得紧跟一个列表，才算真的是目录
        for follow in lines[i + 1:i + 4]:
            if follow.strip():
                if LIST_ITEM_PATTERN.match(follow):
                    return i, len(match.group(1))
                break
    return None, 0


def _match_heading(
    label: str, headings: List[Tuple[int, str, str]]
) -> Optional[Tuple[str, str]]:
    """按目录条目的纯文本找到对应标题，返回 (标题文字, 锚点)；找不到返回 None。"""
    key = github_slug(label)
    if not key:
        return None
    for _, text, slug in headings:
        if slug == key:
            return text, slug
    # 目录条目常被模型简写（或标题带了 "1." 这类编号），退一步做唯一包含匹配
    candidates = [(text, slug) for _, text, slug in headings if key in slug or slug in key]
    return candidates[0] if len(candidates) == 1 else None
