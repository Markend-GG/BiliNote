import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "app" / "utils" / "screenshot_marker.py"
spec = importlib.util.spec_from_file_location("screenshot_marker", MODULE_PATH)
if spec is None or spec.loader is None:
    raise ImportError("screenshot_marker module spec not found")
screenshot_marker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screenshot_marker)
extract_screenshot_timestamps = screenshot_marker.extract_screenshot_timestamps
drop_screenshot_marker = screenshot_marker.drop_screenshot_marker
lift_markers_out_of_headings = screenshot_marker.lift_markers_out_of_headings
collapse_image_runs = screenshot_marker.collapse_image_runs
move_first_image_under_heading = screenshot_marker.move_first_image_under_heading


class TestScreenshotMarker(unittest.TestCase):
    def test_extract_accepts_star_bracket_format(self):
        markdown = "A\n*Screenshot-[01:02]\nB"
        matches = extract_screenshot_timestamps(markdown)
        self.assertEqual(matches, [("*Screenshot-[01:02]", 62)])

    def test_extract_accepts_legacy_formats(self):
        markdown = "*Screenshot-03:04 and Screenshot-[05:06]"
        matches = extract_screenshot_timestamps(markdown)
        self.assertEqual(
            matches,
            [
                ("*Screenshot-03:04", 184),
                ("Screenshot-[05:06]", 306),
            ],
        )


class TestDropScreenshotMarker(unittest.TestCase):
    def test_removes_whole_line_when_marker_alone(self):
        markdown = "## 小节\n*Screenshot-[01:02]\n正文"
        self.assertEqual(drop_screenshot_marker(markdown, "*Screenshot-[01:02]"), "## 小节\n正文")

    def test_removes_inline_marker_only(self):
        markdown = "看图 *Screenshot-[01:02] 说明"
        self.assertEqual(drop_screenshot_marker(markdown, "*Screenshot-[01:02]"), "看图  说明")

    def test_noop_when_marker_absent(self):
        markdown = "## 小节\n正文"
        self.assertEqual(drop_screenshot_marker(markdown, "*Screenshot-[09:09]"), markdown)


class TestLongVideoTimestamps(unittest.TestCase):
    def test_minutes_over_99_are_parsed(self):
        """100 分钟以上的课，模型会写 *Screenshot-[102:47]*。"""
        matches = extract_screenshot_timestamps("*Screenshot-[102:47] 和 Screenshot-100:05")
        self.assertEqual(matches, [("*Screenshot-[102:47]", 6167), ("Screenshot-100:05", 6005)])


class TestLiftMarkersOutOfHeadings(unittest.TestCase):
    def test_content_marker_moves_below_heading(self):
        markdown = "## 4. 全课总结 *Content-[102:47]*\n\n正文"
        self.assertEqual(
            lift_markers_out_of_headings(markdown),
            "## 4. 全课总结\n*Content-[102:47]*\n\n正文",
        )

    def test_screenshot_marker_moves_below_heading(self):
        self.assertEqual(
            lift_markers_out_of_headings("## 小节 *Screenshot-[01:02]*"),
            "## 小节\n*Screenshot-[01:02]*",
        )

    def test_body_lines_and_code_blocks_are_untouched(self):
        markdown = "正文里的 *Content-[00:05]*\n\n```\n## 代码块里的标题 *Content-[00:06]*\n```"
        self.assertEqual(lift_markers_out_of_headings(markdown), markdown)


class TestCollapseImageRuns(unittest.TestCase):
    def test_consecutive_images_keep_only_the_first(self):
        markdown = "![](a.jpg)\n![](b.jpg)\n\n![](c.jpg)\n正文\n![](d.jpg)"
        result, dropped = collapse_image_runs(markdown)
        self.assertEqual(result, "![](a.jpg)\n\n正文\n![](d.jpg)")
        self.assertEqual(dropped, ["b.jpg", "c.jpg"])

    def test_heading_between_images_breaks_the_run(self):
        """两道例题各自的题干图之间隔着标题，不能当成连插删掉。"""
        markdown = "![](a.jpg)\n\n### 例题2\n\n![](b.jpg)"
        result, dropped = collapse_image_runs(markdown)
        self.assertEqual(dropped, [])
        self.assertEqual(result, markdown)

    def test_explanation_between_images_keeps_both(self):
        markdown = "![](a.jpg)\n这一步先列式\n![](b.jpg)"
        _, dropped = collapse_image_runs(markdown)
        self.assertEqual(dropped, [])

    def test_indented_and_titled_images_are_still_detected(self):
        markdown = "  ![](a.jpg)  \n![](b.jpg)"
        _, dropped = collapse_image_runs(markdown)
        self.assertEqual(dropped, ["b.jpg"])


class TestMoveFirstImageUnderHeading(unittest.TestCase):
    """轻量模型总把截图写到小节末尾（实测 43 个小节全部如此），必须在代码里搬回标题下。"""

    def test_image_at_section_end_moves_under_heading(self):
        markdown = "### 例题1｜2024浙江（06:18）\n**题干**：xxx\n**分步解析**：yyy\n**答案**：D\n![](a.jpg)"
        self.assertEqual(
            move_first_image_under_heading(markdown),
            "### 例题1｜2024浙江（06:18）\n![](a.jpg)\n**题干**：xxx\n**分步解析**：yyy\n**答案**：D",
        )

    def test_image_goes_after_origin_link(self):
        markdown = "## 题型一\n[原片 @ 01:00](https://x?t=60)\n识别信号\n![](a.jpg)"
        lines = move_first_image_under_heading(markdown).split("\n")
        self.assertEqual(lines[1], "[原片 @ 01:00](https://x?t=60)")
        self.assertEqual(lines[2], "![](a.jpg)")
        self.assertEqual(lines[3], "识别信号")

    def test_image_already_in_place_is_untouched(self):
        markdown = "## 小节\n![](a.jpg)\n正文"
        self.assertEqual(move_first_image_under_heading(markdown), markdown)

    def test_only_the_first_image_moves(self):
        markdown = "## 小节\n开头\n![](a.jpg)\n中间\n![](b.jpg)\n结尾"
        self.assertEqual(
            move_first_image_under_heading(markdown),
            "## 小节\n![](a.jpg)\n开头\n中间\n![](b.jpg)\n结尾",
        )

    def test_images_inside_code_blocks_are_ignored(self):
        markdown = "## 小节\n```\n![](code.jpg)\n```\n正文\n![](real.jpg)"
        self.assertEqual(
            move_first_image_under_heading(markdown),
            "## 小节\n![](real.jpg)\n```\n![](code.jpg)\n```\n正文",
        )

    def test_image_before_any_heading_stays(self):
        markdown = "![](a.jpg)\n## 小节\n正文"
        self.assertEqual(move_first_image_under_heading(markdown), markdown)

    def test_each_section_moves_its_own_image(self):
        markdown = "## 甲\n甲正文\n![](a.jpg)\n## 乙\n乙正文\n![](b.jpg)"
        self.assertEqual(
            move_first_image_under_heading(markdown),
            "## 甲\n![](a.jpg)\n甲正文\n## 乙\n![](b.jpg)\n乙正文",
        )


if __name__ == "__main__":
    unittest.main()
