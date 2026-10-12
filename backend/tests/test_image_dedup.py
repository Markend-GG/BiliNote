import pathlib
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.utils.image_dedup import compute_signature, hamming_distance, has_more_detail, is_similar


def make_slide(lines: int, dark: bool = False, cursor: bool = False, noise: int = 0) -> Image.Image:
    bg, fg = ((30, 30, 30), (240, 240, 240)) if dark else ((255, 255, 255), (20, 20, 20))
    img = Image.new("RGB", (1280, 720), bg)
    draw = ImageDraw.Draw(img)
    draw.rectangle([80, 50, 1200, 95], fill=fg)
    for i in range(lines):
        y = 150 + i * 60
        draw.rectangle([120, y, 1000 - i * 30, y + 26], fill=fg)
    if cursor:
        draw.polygon([(600, 360), (600, 400), (626, 384)], fill=bg, outline=fg)
    if noise:
        arr = np.asarray(img, dtype=np.int16)
        arr = np.clip(arr + np.random.default_rng(11).integers(-noise, noise + 1, arr.shape), 0, 255)
        img = Image.fromarray(arr.astype(np.uint8))
    return img


class TestImageDedup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.dir = pathlib.Path(cls._tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _save(self, name: str, img: Image.Image, quality: int = 92) -> str:
        path = self.dir / f"{name}.jpg"
        img.save(path, quality=quality)
        return str(path)

    def test_identical_frames_are_similar(self):
        slide = make_slide(3)
        a = compute_signature(self._save("same_a", slide))
        b = compute_signature(self._save("same_b", slide))
        self.assertEqual(hamming_distance(a.dhash, b.dhash), 0)
        self.assertTrue(is_similar(a, b))

    def test_cursor_and_noise_do_not_break_similarity(self):
        base = compute_signature(self._save("base", make_slide(3)))
        with_cursor = compute_signature(self._save("cursor", make_slide(3, cursor=True)))
        noisy = compute_signature(self._save("noisy", make_slide(3, noise=6)))
        recompressed = compute_signature(self._save("recompressed", make_slide(3), quality=55))
        self.assertTrue(is_similar(base, with_cursor))
        self.assertTrue(is_similar(base, noisy))
        self.assertTrue(is_similar(base, recompressed))

    def test_different_slides_are_not_similar(self):
        base = compute_signature(self._save("slide3", make_slide(3)))
        more_content = compute_signature(self._save("slide6", make_slide(6)))
        dark_theme = compute_signature(self._save("dark", make_slide(3, dark=True)))
        self.assertFalse(is_similar(base, more_content))
        self.assertFalse(is_similar(base, dark_theme))

    def test_fuller_board_has_more_detail(self):
        partial = compute_signature(self._save("partial", make_slide(3)))
        fuller = compute_signature(self._save("fuller", make_slide(4)))
        self.assertTrue(has_more_detail(fuller, partial))
        self.assertFalse(has_more_detail(partial, fuller))


if __name__ == "__main__":
    unittest.main()
