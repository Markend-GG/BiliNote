"""判断两张截图是否"看起来一样"，用于笔记截图与抽帧的相似图去重。

只依赖 Pillow + numpy，两个指标同时达标才判为相似：
1. dHash（32x32，1024 位）汉明距离——整体结构指纹；
2. 缩略灰度图上"明显变化的像素占比"——补充结构指纹分辨不出的局部改动。

阈值由合成课件标定：同页多写一行/鼠标光标/压缩噪声 → 相似；同模板换页/多出一张图/换主题 → 不同。
宁可漏判（多留一张重复图）也不误判（把两页不同课件合成一张）。
"""
from typing import NamedTuple

import numpy as np
from PIL import Image

HASH_SIZE = 32
GRAY_SIZE = (160, 90)
# 1024 位中允许不同的位数上限。
# 定 60 是实测调出来的：真实课件视频里"板书逐笔写出来"的相邻帧，像素只变了 1.0-1.5%，
# 但压缩噪声会让 dHash 抖到 43-50，原先的 40 拦不住（一条 103 分钟的课 154 张图一张没合并）。
# 真正区分"同页多写一行"和"换了一页"的是下面的变化像素占比，所以这里放宽是安全的：
# 合成标定集里换页=2.31%、多出一张图表=2.10%，都过不了 1.6% 这道闸。
DHASH_MAX_DISTANCE = 60
# 灰度差超过这个值才算"这个像素变了"（0-255 量纲）
CHANGED_PIXEL_THRESHOLD = 30
# 变化像素占比上限
MAX_CHANGED_RATIO = 0.016
# 同组相似图里，细节分高出这个比例才认为"内容更全"，用它替换已保留的那张
DETAIL_MARGIN = 1.1


class ImageSignature(NamedTuple):
    dhash: int
    gray: np.ndarray
    detail: float


def compute_signature(image_path: str) -> ImageSignature:
    with Image.open(image_path) as img:
        gray_img = img.convert("L")
        small = gray_img.resize((HASH_SIZE + 1, HASH_SIZE), Image.Resampling.LANCZOS)
        thumb = gray_img.resize(GRAY_SIZE, Image.Resampling.LANCZOS)
    small_arr = np.asarray(small, dtype=np.uint8)
    gray_arr = np.asarray(thumb, dtype=np.float32)

    dhash = 0
    for bit in (small_arr[:, 1:] > small_arr[:, :-1]).flatten():
        dhash = (dhash << 1) | int(bit)

    # 细节分 = 横竖两方向的平均梯度强度，板书写得越满这个值越大
    detail = float(
        np.abs(np.diff(gray_arr, axis=1)).mean() + np.abs(np.diff(gray_arr, axis=0)).mean()
    )
    return ImageSignature(dhash=dhash, gray=gray_arr, detail=detail)


def hamming_distance(hash_a: int, hash_b: int) -> int:
    return bin(hash_a ^ hash_b).count("1")


def changed_ratio(sig_a: ImageSignature, sig_b: ImageSignature) -> float:
    diff = np.abs(sig_a.gray - sig_b.gray)
    return float((diff > CHANGED_PIXEL_THRESHOLD).mean())


def is_similar(sig_a: ImageSignature, sig_b: ImageSignature) -> bool:
    if hamming_distance(sig_a.dhash, sig_b.dhash) > DHASH_MAX_DISTANCE:
        return False
    return changed_ratio(sig_a, sig_b) <= MAX_CHANGED_RATIO


def has_more_detail(sig: ImageSignature, other: ImageSignature) -> bool:
    return sig.detail > other.detail * DETAIL_MARGIN
