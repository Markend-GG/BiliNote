import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "app" / "utils" / "markdown_toc.py"
spec = importlib.util.spec_from_file_location("markdown_toc", MODULE_PATH)
if spec is None or spec.loader is None:
    raise ImportError("markdown_toc module spec not found")
markdown_toc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(markdown_toc)
github_slug = markdown_toc.github_slug
collect_heading_slugs = markdown_toc.collect_heading_slugs
linkify_toc = markdown_toc.linkify_toc
nest_example_headings = markdown_toc.nest_example_headings


class TestGithubSlug(unittest.TestCase):
    def test_matches_github_slugger(self):
        """期望值全部由 github-slugger 1.5.0（前端 rehype-slug 依赖的版本）实跑得到。"""
        cases = {
            "第一节：基期倍比与两期比重差问题": "第一节基期倍比与两期比重差问题",
            "0. 引入与题型定位": "0-引入与题型定位",
            "AI 总结": "ai-总结",
            "第三节 年均增长量与年均增长率（含公式）": "第三节-年均增长量与年均增长率含公式",
            "①②③ 编号项": "-编号项",
            "　全角空格　": "全角空格",
            "Video: Introduction & Setup!": "video-introduction--setup",
            "标题_with_underscore": "标题_with_underscore",
            "React Hooks（一）：useState 与 useEffect": "react-hooks一usestate-与-useeffect",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(github_slug(text), expected)

    def test_duplicate_headings_get_numeric_suffix(self):
        slugs = [slug for _, _, slug in collect_heading_slugs("# 小结\n\n## 小结\n\n## 小结")]
        self.assertEqual(slugs, ["小结", "小结-1", "小结-2"])

    def test_headings_inside_code_blocks_are_ignored(self):
        markdown = "## 真标题\n\n```\n## 代码里的假标题\n```\n"
        self.assertEqual([text for _, text, _ in collect_heading_slugs(markdown)], ["真标题"])


class TestLinkifyToc(unittest.TestCase):
    def test_plain_items_become_anchor_links(self):
        markdown = (
            "## 目录\n"
            "- 0. 引入与题型定位\n"
            "- AI 总结\n\n"
            "## 0. 引入与题型定位\n\n正文\n\n"
            "## AI 总结\n\n结尾\n"
        )
        result = linkify_toc(markdown)
        self.assertIn("- [0. 引入与题型定位](#0-引入与题型定位)", result)
        self.assertIn("- [AI 总结](#ai-总结)", result)

    def test_wrong_anchor_is_corrected_and_label_kept(self):
        markdown = "## 目录\n- [第一节：基期倍比](#第一节)\n\n## 第一节：基期倍比\n\n正文\n"
        result = linkify_toc(markdown)
        self.assertIn("- [第一节：基期倍比](#第一节基期倍比)", result)

    def test_toc_item_abbreviating_numbered_heading_still_matches(self):
        markdown = "## 目录\n- 第一节：基期倍比与两期比重差问题\n\n## 1. 第一节：基期倍比与两期比重差问题\n\n正文\n"
        result = linkify_toc(markdown)
        self.assertIn("(#1-第一节基期倍比与两期比重差问题)", result)

    def test_unmatched_item_is_left_alone(self):
        markdown = "## 目录\n- 不存在的章节\n\n## 真标题\n\n正文\n"
        self.assertEqual(linkify_toc(markdown), markdown)

    def test_body_section_named_like_toc_is_not_treated_as_toc(self):
        markdown = (
            "# 笔记\n\n## 第一章\n\n正文\n\n"
            "## 目录结构详解\n\n- 根目录\n- 子目录\n"
        )
        self.assertEqual(linkify_toc(markdown), markdown)

    def test_nested_and_ordered_items_keep_their_bullet(self):
        markdown = "## 目录\n1. 第一章\n   - 小节一\n\n## 第一章\n\n### 小节一\n"
        result = linkify_toc(markdown)
        self.assertIn("1. [第一章](#第一章)", result)
        self.assertIn("   - [小节一](#小节一)", result)


class TestLinkifyTocMessyItems(unittest.TestCase):
    """真实笔记里模型把目录条目写坏的两种样子，都要修成干净的单行链接。"""

    def test_label_containing_nested_origin_link_is_cleaned(self):
        markdown = (
            "## 目录\n"
            "- [二、基础公式 [原片 @ 00:08](https://x?t=8)](#二基础公式-content-0008)\n\n"
            "## 二、基础公式\n\n正文\n"
        )
        result = linkify_toc(markdown)
        self.assertIn("- [二、基础公式](#二基础公式)", result)
        self.assertNotIn("]](", result)
        self.assertNotIn("原片", result.split("## 二、基础公式\n\n正文")[0])

    def test_multiline_label_is_joined_into_one_line(self):
        markdown = (
            "## 目录\n"
            "- [三、基期量的比较\n"
            "原片（03:30）\n"
            "](#三基期量的比较-content-0330)\n\n"
            "## 三、基期量的比较\n\n正文\n"
        )
        result = linkify_toc(markdown)
        self.assertIn("- [三、基期量的比较](#三基期量的比较)", result)
        self.assertNotIn("原片（03:30）", result)
        self.assertNotIn("](#三基期量的比较-content-0330)", result)


class TestNestExampleHeadings(unittest.TestCase):
    def test_examples_go_one_level_under_their_predecessor(self):
        markdown = (
            "## 三、基期量的比较\n### 解法A｜加减法\n正文\n"
            "### 例题1｜2021青海（05:12）\n正文\n### 例题2｜x（08:08）\n"
            "### 解法B｜乘除\n### 例题3｜y\n"
        )
        result = nest_example_headings(markdown)
        self.assertIn("#### 例题1｜2021青海（05:12）", result)
        self.assertIn("#### 例题2｜x（08:08）", result)  # 连续例题与上一道同级
        self.assertIn("#### 例题3｜y", result)
        self.assertIn("### 解法A｜加减法", result)
        self.assertIn("### 解法B｜乘除", result)

    def test_example_directly_under_section(self):
        markdown = "## 题型一\n### 识别信号\nx\n### 例题1｜a\n"
        self.assertIn("#### 例题1｜a", nest_example_headings(markdown))

    def test_headings_in_code_blocks_untouched(self):
        markdown = "```\n### 例题99\n```\n## 节\n### 解法A\n### 例题1\n"
        result = nest_example_headings(markdown)
        self.assertIn("### 例题99", result)   # 代码块里的不动
        self.assertIn("#### 例题1", result)   # 解法下的例题压一级

    def test_example_directly_under_section_stays_one_level_deeper(self):
        markdown = "## 节\n### 例题1\n"
        self.assertIn("### 例题1", nest_example_headings(markdown))


if __name__ == "__main__":
    unittest.main()
