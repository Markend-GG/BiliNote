import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

try:
    from app.gpt.prompt import MERGE_PROMPT
    from app.gpt.prompt_builder import generate_base_prompt, get_style_format, note_styles
    IMPORT_ERROR = None
except Exception as exc:  # 宿主没装 fastapi 时跳过，容器内会真正跑
    IMPORT_ERROR = exc

COURSE_STYLES = ("xingce_course", "shenlun_course")
CHEATSHEET_STYLE = "xingce_cheatsheet"


@unittest.skipIf(IMPORT_ERROR is not None, f"需要后端依赖：{IMPORT_ERROR}")
class TestNoteStyleCatalog(unittest.TestCase):
    def test_every_listed_style_has_a_prompt(self):
        """风格清单在三处各存一份，这里守住后端这份：列出来的都必须有提示词。"""
        for entry in note_styles:
            with self.subTest(style=entry["value"]):
                self.assertTrue(get_style_format(entry["value"]).strip(), f"{entry['value']} 没有提示词")

    def test_course_styles_are_listed(self):
        labels = {entry["value"]: entry["label"] for entry in note_styles}
        for style in COURSE_STYLES + (CHEATSHEET_STYLE,):
            self.assertIn(style, labels)
        self.assertEqual(labels["xingce_course"], "行测课程")
        self.assertEqual(labels["shenlun_course"], "申论课程")
        self.assertEqual(labels[CHEATSHEET_STYLE], "行测速查卡")

    def test_unknown_style_degrades_to_empty(self):
        self.assertEqual(get_style_format("not_a_style"), "")


@unittest.skipIf(IMPORT_ERROR is not None, f"需要后端依赖：{IMPORT_ERROR}")
class TestCourseStylePrompt(unittest.TestCase):
    def test_hard_requirements_come_first(self):
        """轻量模型对靠前的指令遵循度更高；上一版把"截图要节制"写在最后，
        模型理解成整体都要精简，直接把 9 道例题全删了（33582 字 → 9861 字）。"""
        for style in COURSE_STYLES:
            prompt = get_style_format(style)
            with self.subTest(style=style):
                self.assertIn("硬性要求（优先级最高", prompt)
                self.assertIn("正文不许省略", prompt)
                self.assertIn("绝不许为了少插图而删掉例题", prompt)
                self.assertIn("截图有上限不代表正文可以缩短", prompt)
                self.assertLess(prompt.index("硬性要求"), prompt.index("本节导读"))

    def test_only_real_exam_questions_count_as_examples(self):
        """用户反馈：老师为讲方法编的演示案例被写成了「例题3」。"""
        for style in COURSE_STYLES:
            prompt = get_style_format(style)
            with self.subTest(style=style):
                self.assertIn("只有真题才算例题", prompt)
                self.assertIn("方法演示", prompt)
                self.assertIn("不编号成例题", prompt)
                self.assertIn("不要编造年份", prompt)

    def test_example_order_is_title_screenshot_then_content(self):
        """用户要求：标题 → 图片 → 题干 + 分步解析 + 答案。"""
        for style in COURSE_STYLES:
            prompt = get_style_format(style)
            with self.subTest(style=style):
                self.assertIn("`### 标题` → 截图 → 题干 → 分步解析 → 答案", prompt)
                self.assertIn("标题下面单独一行写 `*Screenshot-[mm:ss]`", prompt)
                self.assertLess(prompt.index("标题下面单独一行写"), prompt.index("**题干**"))

    def test_organized_by_question_type_with_method_next_to_examples(self):
        for style in COURSE_STYLES:
            prompt = get_style_format(style)
            with self.subTest(style=style):
                self.assertIn("以题型为主线", prompt)
                self.assertIn("主轴怎么选", prompt)
                self.assertIn("方法与它的例题必须挨在一起", prompt)

    def test_multiple_solutions_listed_with_choice_table(self):
        """同一题型老师讲了多种解法时，要并列写清各自适用条件与考场首选。"""
        for style, word in (("xingce_course", "解法"), ("shenlun_course", "思路")):
            prompt = get_style_format(style)
            with self.subTest(style=style):
                self.assertIn(f"{word}A", prompt)
                self.assertIn(f"{word}B", prompt)
                self.assertIn("适用条件", prompt)
                self.assertIn("老师是否推荐", prompt)
                self.assertIn("不许自己猜", prompt)

    def test_screenshots_cover_lecturing_but_are_capped(self):
        for style in COURSE_STYLES:
            prompt = get_style_format(style)
            with self.subTest(style=style):
                self.assertIn("讲解处", prompt)
                self.assertIn("每道例题最多 2 张", prompt)
                self.assertIn("禁止连续插图", prompt)
                self.assertIn("30 张上下", prompt)

    def test_forbids_inventing_content_and_covers_missing_sections(self):
        for style in COURSE_STYLES:
            prompt = get_style_format(style)
            with self.subTest(style=style):
                self.assertIn("本节未涉及", prompt)
                self.assertIn("不要编造", prompt)

    def test_markers_only_when_format_requested(self):
        """没勾原片截图/跳转时写标记，会在笔记里留下无法解析的原始文本。"""
        for style in COURSE_STYLES + (CHEATSHEET_STYLE,):
            with self.subTest(style=style):
                self.assertIn("只有本次任务要求「原片截图」时", get_style_format(style))

    def test_allows_minutes_over_99(self):
        for style in COURSE_STYLES + (CHEATSHEET_STYLE,):
            with self.subTest(style=style):
                self.assertIn("分钟位可以超过 59", get_style_format(style))

    def test_xingce_ends_with_lookup_table_and_checklist(self):
        prompt = get_style_format("xingce_course")
        for keyword in ("本节导读", "识别信号", "核心公式", "本题型易错点",
                        "通用速算技巧", "全节速查表", "本节自测清单", "LaTeX"):
            self.assertIn(keyword, prompt)

    def test_shenlun_covers_framework_and_wording(self):
        prompt = get_style_format("shenlun_course")
        for keyword in ("审题要点", "材料找点方法", "答题框架", "规范表述对照",
                        "参考答案", "大作文素材", "全节速查表"):
            self.assertIn(keyword, prompt)

    def test_cheatsheet_is_tables_only(self):
        prompt = get_style_format(CHEATSHEET_STYLE)
        self.assertIn("不要写例题正文", prompt)
        self.assertIn("题型速查表", prompt)
        self.assertIn("公式卡", prompt)
        self.assertIn("秒杀技巧", prompt)
        self.assertIn("速查卡一般不插图", prompt)


@unittest.skipIf(IMPORT_ERROR is not None, f"需要后端依赖：{IMPORT_ERROR}")
class TestPromptAssembly(unittest.TestCase):
    def test_style_is_appended_after_formats_and_before_extras(self):
        prompt = generate_base_prompt(
            title="资料分析系统课",
            segment_text="00:00 - 开场",
            tags=[],
            _format=["toc", "screenshot"],
            style="xingce_course",
            extras="请多记公式",
        )
        toc_at = prompt.index("**目录**")
        shot_at = prompt.index("**原片截图**")
        style_at = prompt.index("行测课程（本次笔记风格）")
        extras_at = prompt.index("请多记公式")
        self.assertLess(toc_at, shot_at)
        self.assertLess(shot_at, style_at)
        self.assertLess(style_at, extras_at)


@unittest.skipIf(IMPORT_ERROR is not None, f"需要后端依赖：{IMPORT_ERROR}")
class TestMergePrompt(unittest.TestCase):
    def test_merge_keeps_style_and_screenshot_position(self):
        """长视频分块合并时不带 style，风格与例题截图位置只能靠合并提示词兜住。"""
        self.assertIn("写作风格", MERGE_PROMPT)
        self.assertIn("Screenshot", MERGE_PROMPT)
        self.assertIn("题干与解析之间", MERGE_PROMPT)


if __name__ == "__main__":
    unittest.main()
