import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw

from app.downloaders import local_downloader as ld

# 关键设计：假 ffmpeg 写"灰底 + 白色亮条，位置随秒数挪"的真实 PIL 图，
# 断言时用像素探针（亮条 x 坐标）证明返回的到底是哪一秒的候选帧。
BAR_X_BY_SECOND = {1: 60, 2: 250, 3: 440}


def frame_with_bar(sec: int) -> Image.Image:
    img = Image.new("RGB", (640, 360), (128, 128, 128))
    draw = ImageDraw.Draw(img)
    x = BAR_X_BY_SECOND[sec]
    draw.rectangle([x, 120, x + 60, 240], fill=(255, 255, 255))
    return img


def solid(level: int) -> Image.Image:
    return Image.new("RGB", (640, 360), (level, level, level))


def make_slide() -> Image.Image:
    """白底课件（mean≈240/std≈20）：内容检查必须放行。"""
    img = Image.new("RGB", (1280, 720), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([80, 50, 1200, 95], fill=(20, 20, 20))
    for i in range(4):
        y = 150 + i * 60
        draw.rectangle([120, y, 1000, y + 26], fill=(20, 20, 20))
    return img


def make_fake_ffmpeg_runner(frames_by_second, fail_secs=(), silent_secs=()):
    """解析 cmd 里的 -ss 与 .jpg 输出路径；fail_secs 抛非零退出，silent_secs 假成功但不写文件。"""
    calls = []

    def _runner(cmd, **kwargs):
        output_path = next((a for a in cmd if isinstance(a, str) and a.endswith(".jpg")), None)
        if output_path is None:
            raise AssertionError(f"ffmpeg cmd 里没有 .jpg 输出路径: {cmd}")
        sec = int(cmd[cmd.index("-ss") + 1])
        calls.append(sec)
        if sec in fail_secs:
            raise subprocess.CalledProcessError(returncode=1, cmd=cmd)
        if sec in silent_secs:
            return 0
        frames_by_second[sec].save(output_path, quality=92)
        return 0

    return _runner, calls


class _CoverTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.src = os.path.join(self.tmp_dir, "clip.mp4")
        pathlib.Path(self.src).write_bytes(b"fake-video")

    def _extract(self, frames_by_second, fail_secs=(), silent_secs=()):
        runner, calls = make_fake_ffmpeg_runner(frames_by_second, fail_secs, silent_secs)
        with patch.object(ld.subprocess, "run", side_effect=runner):
            cover = ld.LocalDownloader().extract_cover(self.src, output_dir=self.tmp_dir)
        return cover, calls

    def _leftovers(self):
        return sorted(os.listdir(self.tmp_dir))

    def assert_cover_is_second(self, cover_path, sec):
        gray = Image.open(cover_path).convert("L")
        bar_x = BAR_X_BY_SECOND[sec]
        self.assertGreater(gray.getpixel((bar_x + 30, 180)), 200, "亮条不在预期秒数的位置")
        for other_x in BAR_X_BY_SECOND.values():
            if other_x != bar_x:
                self.assertLess(gray.getpixel((other_x + 30, 180)), 200, "返回了别的候选帧")


class TestExtractCoverCandidates(_CoverTestCase):
    def test_first_contentful_frame_wins_and_stops(self):
        """1s 就有内容 → 直接用 1s、不再试后面；目录只有最终文件。"""
        cover, calls = self._extract({1: frame_with_bar(1), 2: frame_with_bar(2), 3: frame_with_bar(3)})
        self.assertEqual(cover, os.path.join(self.tmp_dir, "clip_cover.jpg"))
        self.assertEqual(calls, [1])
        self.assert_cover_is_second(cover, 1)
        self.assertEqual(self._leftovers(), ["clip.mp4", "clip_cover.jpg"])

    def test_black_first_second_jumps_to_next(self):
        """1s 黑场 → 跳 2s，返回的是 2s 的帧。"""
        cover, calls = self._extract({1: solid(0), 2: frame_with_bar(2)})
        self.assertEqual(calls, [1, 2])
        self.assert_cover_is_second(cover, 2)

    def test_crash_then_black_then_content(self):
        """1s ffmpeg 崩（如无视频流）不中断循环；2s 黑 → 3s 内容胜出。"""
        cover, calls = self._extract({2: solid(0), 3: frame_with_bar(3)}, fail_secs={1})
        self.assertEqual(calls, [1, 2, 3])
        self.assert_cover_is_second(cover, 3)

    def test_all_rejected_falls_back_to_first_frame(self):
        """三个候选都不合格（黑/纯灰/纯白）→ 回退第一张成功提取的帧（1s），无临时残留。"""
        cover, calls = self._extract({1: solid(0), 2: solid(128), 3: solid(255)})
        self.assertEqual(calls, [1, 2, 3])
        self.assertEqual(cover, os.path.join(self.tmp_dir, "clip_cover.jpg"))
        self.assertLess(Image.open(cover).convert("L").getpixel((320, 180)), 40, "回退的应该是 1s 黑帧")
        self.assertEqual(self._leftovers(), ["clip.mp4", "clip_cover.jpg"])

    def test_no_candidate_output_returns_none(self):
        """全失败（崩/假成功无文件）→ None、不留任何文件。"""
        cover, calls = self._extract({}, fail_secs={1, 3}, silent_secs={2})
        self.assertIsNone(cover)
        self.assertEqual(calls, [1, 2, 3])
        self.assertEqual(self._leftovers(), ["clip.mp4"])


class TestDownloadDegradation(_CoverTestCase):
    def test_audio_without_video_degrades_to_no_cover(self):
        """纯音频（无画面）：extract_cover → None，download 不抛异常、cover_url=None、不调 save_cover_to_static。"""
        audio_path = os.path.join(self.tmp_dir, "clip.mp3")
        runner, _ = make_fake_ffmpeg_runner({}, fail_secs=(1, 2, 3))
        with patch.object(ld.subprocess, "run", side_effect=runner), \
                patch.object(ld.LocalDownloader, "convert_to_mp3", return_value=audio_path), \
                patch.object(ld, "save_cover_to_static") as save_mock:
            result = ld.LocalDownloader().download(self.src)
        self.assertIsNone(result.cover_url)
        save_mock.assert_not_called()
        self.assertEqual(result.file_path, audio_path)
        self.assertEqual(result.platform, "local")

    def test_download_video_error_message_contains_path(self):
        """download_video 缺失文件的报错必须带路径（此前是裸 FileNotFoundError，UI 只显示"任务失败"）。"""
        with self.assertRaises(FileNotFoundError) as ctx:
            ld.LocalDownloader().download_video("/uploads/missing-lecture.mp4")
        self.assertIn("missing-lecture.mp4", str(ctx.exception))

        absolute_missing = os.path.join(self.tmp_dir, "not-here.mp4")
        with self.assertRaises(FileNotFoundError) as ctx2:
            ld.LocalDownloader().download_video(absolute_missing)
        self.assertIn("not-here.mp4", str(ctx2.exception))


class TestFrameHasContent(_CoverTestCase):
    def _probe(self, img: Image.Image) -> bool:
        path = os.path.join(self.tmp_dir, "probe.jpg")
        img.save(path, quality=92)
        return ld._frame_has_content(path)

    def test_blank_frames_rejected(self):
        self.assertFalse(self._probe(solid(0)), "纯黑")
        self.assertFalse(self._probe(solid(128)), "纯灰")
        self.assertFalse(self._probe(solid(255)), "纯白/白闪")

    def test_slide_frame_accepted(self):
        self.assertTrue(self._probe(make_slide()))

    def test_unreadable_file_is_not_content(self):
        broken = os.path.join(self.tmp_dir, "broken.jpg")
        pathlib.Path(broken).write_bytes(b"not an image")
        self.assertFalse(ld._frame_has_content(broken))


if __name__ == "__main__":
    unittest.main()