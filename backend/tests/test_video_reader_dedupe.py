import pathlib
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw

from app.utils.video_reader import VideoReader
from app.utils import video_reader as video_reader_module


def make_slide(lines: int, cursor: bool = False, chart: bool = False, extra_line: bool = False) -> Image.Image:
    """造一张"课件"：白底 + 标题条 + lines 行正文条。"""
    img = Image.new("RGB", (1280, 720), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([80, 50, 1200, 95], fill=(20, 20, 20))
    for i in range(lines):
        y = 150 + i * 60
        draw.rectangle([120, y, 1000 - i * 30, y + 26], fill=(20, 20, 20))
    if extra_line:
        # 模拟老师又补了一行板书：画面几乎没变，但内容更全
        draw.rectangle([120, 400, 720, 412], fill=(20, 20, 20))
    if chart:
        draw.rectangle([820, 460, 1200, 680], outline=(20, 20, 20), width=5)
        draw.line([(850, 650), (950, 520), (1050, 600), (1170, 480)], fill=(200, 40, 40), width=6)
    if cursor:
        draw.polygon([(600, 360), (600, 400), (626, 384)], fill=(255, 255, 255), outline=(0, 0, 0))
    return img


def _make_fake_ffmpeg_runner(images_by_second):
    def _runner(cmd, check=True):
        output_path = next((arg for arg in cmd if isinstance(arg, str) and arg.endswith(".jpg")), None)
        if output_path is None:
            raise AssertionError("Output path not found in ffmpeg cmd")
        match = re.search(r"frame_(\d{2,3})_(\d{2})\.jpg$", output_path)
        if match is None:
            raise AssertionError(f"Unexpected output path: {output_path}")
        sec = int(match.group(1)) * 60 + int(match.group(2))
        images_by_second[sec].save(output_path, quality=92)
        return 0

    return _runner


class TestVideoReaderDeduplicateFrames(unittest.TestCase):
    def _run(self, images_by_second, action, duration=None, **reader_kwargs):
        with tempfile.TemporaryDirectory() as tmp_dir:
            reader = VideoReader(
                video_path="dummy.mp4",
                frame_interval=1,
                frame_dir=str(pathlib.Path(tmp_dir) / "frames"),
                grid_dir=str(pathlib.Path(tmp_dir) / "grids"),
                **reader_kwargs,
            )
            duration = str(duration if duration is not None else max(images_by_second) + 1)
            with patch.object(video_reader_module.ffmpeg, "probe",
                              return_value={"format": {"duration": duration}}), \
                    patch.object(video_reader_module.subprocess, "run",
                                 side_effect=_make_fake_ffmpeg_runner(images_by_second)):
                return action(reader), pathlib.Path(reader.frame_dir)

    def _extract(self, images_by_second, max_frames=10, duration=None, **reader_kwargs):
        (paths, frame_dir) = self._run(images_by_second, lambda r: r.extract_frames(max_frames=max_frames),
                                       duration=duration, **reader_kwargs)
        return [pathlib.Path(p).name for p in paths], frame_dir

    def test_skips_identical_adjacent_frames(self):
        same = make_slide(3)
        other = make_slide(3, chart=True)
        names, _ = self._extract({0: same, 1: same, 2: other, 3: other})
        self.assertEqual(names, ["frame_00_00.jpg", "frame_00_02.jpg"])

    def test_skips_visually_similar_frames(self):
        """同一页课件只是多了个鼠标指针 → 只留一张；换了一页 → 保留。"""
        names, _ = self._extract({0: make_slide(3), 1: make_slide(3, cursor=True), 2: make_slide(5)})
        self.assertEqual(names, ["frame_00_00.jpg", "frame_00_02.jpg"])

    def test_keeps_the_more_complete_frame_of_a_similar_group(self):
        """板书逐渐写满时留下写满的那一帧，网格图上的时间水印也跟着更新。"""
        names, _ = self._extract({0: make_slide(3), 1: make_slide(3, extra_line=True)})
        self.assertEqual(names, ["frame_00_01.jpg"])

    def test_long_video_stretches_step_to_reach_the_tail(self):
        """帧数有上限时自动放大步长：30 秒视频、间隔 1 秒、上限 5 帧 → 步长 6 秒，覆盖到片尾。"""
        slides = {0: make_slide(1), 6: make_slide(3), 12: make_slide(5), 18: make_slide(7), 24: make_slide(9)}
        names, _ = self._extract(slides, max_frames=5, duration=30)
        self.assertEqual(names, ["frame_00_00.jpg", "frame_00_06.jpg", "frame_00_12.jpg",
                                 "frame_00_18.jpg", "frame_00_24.jpg"])

    def test_keeps_everything_when_dedupe_disabled(self):
        same = make_slide(3)
        names, _ = self._extract({0: same, 1: same}, dedupe_enabled=False)
        self.assertEqual(names, ["frame_00_00.jpg", "frame_00_01.jpg"])

    def test_duplicate_frame_files_are_deleted(self):
        same = make_slide(3)
        names, frame_dir = self._extract({0: same, 1: same, 2: make_slide(6)})
        self.assertEqual(names, ["frame_00_00.jpg", "frame_00_02.jpg"])
        self.assertFalse((frame_dir / "frame_00_01.jpg").exists())

    def test_run_still_emits_grid_when_frames_are_fewer_than_cells(self):
        """去重后只剩 2 张、网格是 2x2 时也要出图，否则模型一张截图都拿不到。"""
        same = make_slide(3)
        (urls, _) = self._run({0: same, 1: same, 2: make_slide(3, chart=True)},
                              lambda r: r.run(), grid_size=(2, 2))
        self.assertEqual(len(urls), 1)
        self.assertTrue(urls[0].startswith("data:image/jpeg;base64,"))


if __name__ == "__main__":
    unittest.main()
