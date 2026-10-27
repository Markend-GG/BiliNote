import os
import subprocess
import uuid
from abc import ABC
from typing import Optional

from PIL import Image, ImageStat

from app.downloaders.base import Downloader
from app.enmus.note_enums import DownloadQuality
from app.models.audio_model import AudioDownloadResult
import os
import subprocess

from app.utils.logger import get_logger
from app.utils.video_helper import save_cover_to_static

logger = get_logger(__name__)

# 封面候选帧：依次尝试第 1/2/3 秒，取第一张"有内容"的帧（跳过黑场/淡入起头）
COVER_CANDIDATE_SECONDS = (1, 2, 3)
# 实测标定：纯黑帧 mean/std = 0/0；纯色/白闪 std≈0（被 std 拦）；带噪声的暗帧 mean 很低（被 mean 拦）；
# 白底课件 mean≈240/std≈20 不误杀。
COVER_MIN_MEAN = 12.0
COVER_MIN_STD = 6.0


def _frame_has_content(image_path: str) -> bool:
    """是否为"有内容"的画面（非纯黑/纯色/白闪）。读不出图按无内容处理。"""
    try:
        stat = ImageStat.Stat(Image.open(image_path).convert("L"))
    except OSError:
        return False
    return stat.mean[0] >= COVER_MIN_MEAN and stat.stddev[0] >= COVER_MIN_STD


class LocalDownloader(Downloader, ABC):
    def __init__(self):

        super().__init__()


    def extract_cover(self, input_path: str, output_dir: Optional[str] = None) -> Optional[str]:
        """
        从本地视频文件中提取一张封面图。

        候选第 1/2/3 秒依次尝试，取第一张"有内容"的帧（跳过黑场/淡入，见 _frame_has_content）；
        全部不合格时回退第一张成功提取的帧（与旧行为一致的 1s 兜底）。
        视频没有画面（纯音频）或全部提取失败时返回 None，由调用方降级为无封面、不再让任务失败。
        :param input_path: 输入视频路径
        :param output_dir: 输出目录，默认和视频同目录
        :return: 提取出的封面图片路径；无法提取时为 None
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"输入文件不存在: {input_path}")

        if output_dir is None:
            output_dir = os.path.dirname(input_path)

        base_name = os.path.splitext(os.path.basename(input_path))[0]
        output_path = os.path.join(output_dir, f"{base_name}_cover.jpg")

        temps = []
        first_ok = None
        try:
            for sec in COVER_CANDIDATE_SECONDS:
                # 临时名必须 .jpg 结尾（ffmpeg 靠扩展名推 muxer），uuid 防并发任务互踩
                candidate = os.path.join(output_dir, f"{base_name}_cover.{uuid.uuid4().hex[:8]}.jpg")
                # 先登记再提取：极端情况下 ffmpeg 写了一半才失败，残留也能被 finally 清掉
                temps.append(candidate)
                try:
                    # 输入 seek（-ss 在 -i 前）：长视频 O(1)，与 video_reader 的抽帧一致
                    subprocess.run(
                        ["ffmpeg", "-ss", str(sec), "-i", input_path,
                         "-frames:v", "1", "-q:v", "2", "-y", candidate],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
                    )
                except subprocess.CalledProcessError:
                    # 无视频流 / seek 超出片长等：换下一个候选
                    continue
                if not os.path.exists(candidate):
                    continue
                if first_ok is None:
                    first_ok = candidate
                if _frame_has_content(candidate):
                    os.replace(candidate, output_path)
                    return output_path

            if first_ok is not None:
                # 三个候选都没通过内容检查（全程黑/纯色）：保留第一张，与旧行为一致
                os.replace(first_ok, output_path)
                return output_path
            return None
        finally:
            # 未采用的临时候选全部清掉（已被 replace 走的那个 remove 会失败，忽略即可）
            for temp in temps:
                try:
                    os.remove(temp)
                except OSError:
                    pass

    def convert_to_mp3(self,input_path: str, output_path: str = None) -> str:
        """
        将本地视频文件转为 MP3 音频文件
        :param input_path: 输入文件路径（如 .mp4）
        :param output_path: 输出文件路径（可选，默认同目录同名 .mp3）
        :return: 生成的 mp3 文件路径
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"输入文件不存在: {input_path}")

        if output_path is None:
            base, _ = os.path.splitext(input_path)
            output_path = base + ".mp3"
        try:
        # 调用 ffmpeg 转换
            command = [
                'ffmpeg',
                '-i', input_path,
                '-vn',  # 不要视频流
                '-acodec', 'libmp3lame',  # 使用mp3编码
                '-y',  # 覆盖输出文件
                output_path
            ]

            subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

            if not os.path.exists(output_path):
                raise RuntimeError(f"mp3 文件生成失败: {output_path}")

            return output_path
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"mp3 文件生成失败: {output_path}") from e
    def download_video(self, video_url: str, output_dir: str = None) -> str:
        """
        处理本地文件路径，返回视频文件路径
        """
        if video_url.startswith('/uploads'):
            project_root = os.getcwd()
            video_url = os.path.join(project_root, video_url.lstrip('/'))
            video_url = os.path.normpath(video_url)

        if not os.path.exists(video_url):
            raise FileNotFoundError(f"本地文件不存在: {video_url}")
        return video_url
    def download(
            self,
            video_url: str,
            output_dir: str = None,
            quality: DownloadQuality = "fast",
            need_video: Optional[bool] = False
    ) -> AudioDownloadResult:
        """
        处理本地文件路径，返回音频元信息
        """
        if video_url.startswith('/uploads'):
            project_root = os.getcwd()
            video_url = os.path.join(project_root, video_url.lstrip('/'))
            video_url = os.path.normpath(video_url)

        if not os.path.exists(video_url):
            raise FileNotFoundError(f"本地文件不存在: {video_url}")

        file_name = os.path.basename(video_url)
        title, _ = os.path.splitext(file_name)
        print(title, file_name,video_url)
        file_path=self.convert_to_mp3(video_url)
        cover_path = self.extract_cover(video_url)
        # 提取不到封面（纯音频/失败）就无封面继续：前端已有 placeholder / 渐变兜底
        cover_url = save_cover_to_static(cover_path) if cover_path else None
        if cover_url is None:
            logger.warning(f"未能提取封面（视频无画面或提取失败），以无封面继续: {video_url}")

        print('file——path',file_path)
        return AudioDownloadResult(
            file_path=file_path,
            title=title,
            duration=0,  # 可选：后续加上读取时长
            cover_url=cover_url,
            platform="local",
            video_id=title,
            raw_info={
                'path':  file_path
            },
            video_path=None
        )
