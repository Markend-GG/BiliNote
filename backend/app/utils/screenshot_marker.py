import re
from typing import List, Tuple

HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
IMAGE_LINE_PATTERN = re.compile(r"^!\[[^\]]*\]\(([^)]+)\)\s*$")
# 分钟位允许 1-3 位：长视频（≥100 分钟）模型会写成 *Content-[102:47]*
MARKER_PATTERN = re.compile(r"\*?(?:Content|Screenshot)-(?:\[\d{1,3}:\d{2}\]|\d{1,3}:\d{2}(?![:\d]))\*?")


def extract_screenshot_timestamps(markdown: str) -> List[Tuple[str, int]]:
    # 首尾的 * 都要一起吃掉：模型常写成 *Screenshot-[mm:ss]*，只匹配前半截会在笔记里留下孤立星号
    pattern = r"(\*?Screenshot-(?:\[(\d{1,3}):(\d{2})\]|(\d{1,3}):(\d{2})(?![:\d]))\*?)"
    results: List[Tuple[str, int]] = []
    for match in re.finditer(pattern, markdown):
        mm = match.group(2) or match.group(4)
        ss = match.group(3) or match.group(5)
        total_seconds = int(mm) * 60 + int(ss)
        results.append((match.group(1), total_seconds))
    return results


def drop_screenshot_marker(markdown: str, marker: str) -> str:
    """删掉一个截图标记；独占一行时连整行删除，免得笔记里留下空行。"""
    lines = markdown.split("\n")
    for i, line in enumerate(lines):
        if marker not in line:
            continue
        if line.strip() == marker:
            del lines[i]
        else:
            lines[i] = line.replace(marker, "", 1).rstrip()
        break
    return "\n".join(lines)


def lift_markers_out_of_headings(markdown: str) -> str:
    """把标题行里的 *Content-[mm:ss]* / *Screenshot-[mm:ss]* 标记挪到标题下面一行。

    提示词要求模型把跳转标记写在标题行末尾，但这样前端 rehype-slug 生成的锚点会变成
    "标题-content-0000"，目录里的 #标题 就对不上（点了不跳）；截图标记也会把图片塞进标题里。
    """
    out: List[str] = []
    in_code_block = False
    for line in markdown.split("\n"):
        if line.lstrip().startswith("```"):
            in_code_block = not in_code_block
            out.append(line)
            continue
        if not in_code_block and HEADING_PATTERN.match(line):
            markers = MARKER_PATTERN.findall(line)
            if markers:
                out.append(MARKER_PATTERN.sub("", line).rstrip())
                out.extend(markers)
                continue
        out.append(line)
    return "\n".join(out)


ORIGIN_LINK_PATTERN = re.compile(r"^\[原片 @ \d{1,3}:\d{2}\]")


def move_first_image_under_heading(markdown: str) -> str:
    """把每个标题小节里的第一张图挪到标题正下方（紧随标题的「原片跳转」链接之后）。

    轻量模型几乎总把 *Screenshot-* 标记写到小节末尾（实测一条笔记 43 个小节全部如此），
    提示词约束不住；用户要的是「标题 → 图 → 题干 → 分步解析 → 答案」，所以在代码里搬。
    只搬每节的第一张图，后面的图留在原处（它们解释的通常是后文内容）。
    """
    lines = markdown.split("\n")
    out: List[str] = []
    i = 0
    in_code_block = False
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith("```"):
            in_code_block = not in_code_block
            out.append(line)
            i += 1
            continue
        if in_code_block or not HEADING_PATTERN.match(line):
            out.append(line)
            i += 1
            continue

        out.append(line)
        i += 1
        # 收拢这个小节的内容：到下一个标题为止，代码块整体算内容
        section: List[str] = []
        code_flags: List[bool] = []
        section_in_code = False
        while i < len(lines):
            current = lines[i]
            if current.lstrip().startswith("```"):
                section.append(current)
                code_flags.append(True)  # 围栏行也标记成代码区，免得被当成图片行
                section_in_code = not section_in_code
                i += 1
                continue
            if not section_in_code and HEADING_PATTERN.match(current):
                break
            section.append(current)
            code_flags.append(section_in_code)
            i += 1

        image_at = next(
            (k for k, text in enumerate(section)
             if not code_flags[k] and IMAGE_LINE_PATTERN.match(text.strip())),
            None,
        )
        if image_at is not None:
            first_content = next((k for k, text in enumerate(section) if text.strip()), None)
            if first_content != image_at:
                image_line = section.pop(image_at)
                section.insert(_image_insert_position(section), image_line)
        out.extend(section)
    return "\n".join(out)


def _image_insert_position(section: List[str]) -> int:
    """插在小节开头，但让「原片跳转」链接继续紧贴标题。"""
    pos = 0
    while pos < len(section) and not section[pos].strip():
        pos += 1
    if pos < len(section) and ORIGIN_LINK_PATTERN.match(section[pos].strip()):
        pos += 1
    return pos


def collapse_image_runs(markdown: str) -> Tuple[str, List[str]]:
    """连续的插图（中间没有任何正文，标题也算正文）只保留第一张。

    模型讲一道题时经常连着插好几帧板书：实测一条 103 分钟的课生成 154 张截图，
    其中 105 张前面紧挨着另一张图、中间一个字都没有，笔记根本没法看。
    返回 (处理后的 markdown, 被丢掉的图片 URL 列表)，调用方负责删掉对应文件。
    """
    out: List[str] = []
    dropped: List[str] = []
    previous_was_image = False
    for line in markdown.split("\n"):
        match = IMAGE_LINE_PATTERN.match(line.strip())
        if match:
            if previous_was_image:
                dropped.append(match.group(1))
                continue
            previous_was_image = True
            out.append(line)
            continue
        if line.strip():
            previous_was_image = False
        out.append(line)
    return "\n".join(out), dropped
