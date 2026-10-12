import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "app" / "utils" / "note_helper.py"
spec = importlib.util.spec_from_file_location("note_helper", MODULE_PATH)
if spec is None or spec.loader is None:
    raise ImportError("note_helper module spec not found")
note_helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(note_helper)


class TestNoteHelper(unittest.TestCase):
    def test_prepend_source_link_adds_header_at_top(self):
        source_url = "https://www.bilibili.com/video/BV1xx411c7mD"
        markdown = "## 标题\n\n内容"

        result = note_helper.prepend_source_link(markdown, source_url)

        self.assertTrue(result.startswith(f"> 来源链接：{source_url}\n\n"))
        self.assertIn("## 标题", result)

    def test_prepend_source_link_does_not_duplicate_when_header_exists(self):
        source_url = "https://www.youtube.com/watch?v=abc123"
        markdown = f"> 来源链接：{source_url}\n\n## 标题\n\n内容"

        result = note_helper.prepend_source_link(markdown, source_url)

        self.assertEqual(result, markdown)


class TestReplaceContentMarkers(unittest.TestCase):
    def test_bilibili_single_part_uses_question_mark(self):
        result = note_helper.replace_content_markers("看这里 *Content-[02:43]*", "BV1h8Ng6cEv4", "bilibili")
        self.assertEqual(result, "看这里 [原片 @ 02:43](https://www.bilibili.com/video/BV1h8Ng6cEv4?t=163)")

    def test_bilibili_multi_part_keeps_p_then_t(self):
        result = note_helper.replace_content_markers("Content-01:00", "BV1xx_p2", "bilibili")
        self.assertEqual(result, "[原片 @ 01:00](https://www.bilibili.com/video/BV1xx?p=2&t=60)")

    def test_minutes_over_99_are_replaced(self):
        """100 分钟以上的课，模型会写 *Content-[102:47]*。"""
        result = note_helper.replace_content_markers("*Content-[102:47]*", "BV1h8Ng6cEv4", "bilibili")
        self.assertEqual(result, "[原片 @ 102:47](https://www.bilibili.com/video/BV1h8Ng6cEv4?t=6167)")

    def test_surrounding_asterisks_are_consumed(self):
        self.assertNotIn("*", note_helper.replace_content_markers("*Content-00:30*", "BV1xx", "bilibili"))

    def test_youtube_and_other_platforms(self):
        self.assertEqual(
            note_helper.replace_content_markers("Content-[00:30]", "abc123", "youtube"),
            "[原片 @ 00:30](https://www.youtube.com/watch?v=abc123&t=30s)",
        )
        self.assertEqual(note_helper.replace_content_markers("Content-[00:30]", "x", "local"), "(00:30)")


if __name__ == "__main__":
    unittest.main()
