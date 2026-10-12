import os
import platform
import threading
import time
from enum import Enum

from app.transcriber.groq import GroqTranscriber
from app.transcriber.whisper import WhisperTranscriber
from app.transcriber.bcut import BcutTranscriber
from app.transcriber.kuaishou import KuaishouTranscriber
from app.utils.logger import get_logger

logger = get_logger(__name__)

class TranscriberType(str, Enum):
    FAST_WHISPER = "fast-whisper"
    MLX_WHISPER = "mlx-whisper"
    BCUT = "bcut"
    KUAISHOU = "kuaishou"
    GROQ = "groq"

# 在 Apple 平台尝试导入 MLX Whisper（不再依赖环境变量，支持前端动态切换）
MLX_WHISPER_AVAILABLE = False
if platform.system() == "Darwin":
    try:
        from app.transcriber.mlx_whisper_transcriber import MLXWhisperTranscriber
        MLX_WHISPER_AVAILABLE = True
        logger.info("MLX Whisper 可用，已导入")
    except ImportError:
        logger.warning("MLX Whisper 导入失败，可能未安装 mlx_whisper")

logger.info('初始化转录服务提供器')

# 转录器单例缓存
_transcribers = {
    TranscriberType.FAST_WHISPER: None,
    TranscriberType.MLX_WHISPER: None,
    TranscriberType.BCUT: None,
    TranscriberType.KUAISHOU: None,
    TranscriberType.GROQ: None,
}

# Cache instances together with their constructor configuration. The
# transcriber choice and Whisper model size can be changed from the frontend,
# so caching by transcriber type alone would keep using the first loaded model.
_transcriber_configs = {key: None for key in _transcribers}
_transcriber_init_lock = threading.Lock()

# ---- 显存回收 ----
# Whisper large-v3-turbo 加载后常驻约 2.3GB 显存，不用也占着。这里记录每个转写器的
# 最后使用时间，闲置超时后由守护线程卸载（下次使用重新加载，约 8 秒）。
# WHISPER_IDLE_UNLOAD_SECONDS=0 可关闭。
_last_used = {key: None for key in _transcribers}
_idle_unloader_started = False
IDLE_UNLOAD_SECONDS = float(os.getenv("WHISPER_IDLE_UNLOAD_SECONDS", "600"))
IDLE_CHECK_SECONDS = float(os.getenv("WHISPER_IDLE_CHECK_SECONDS", "60"))


def touch_transcriber(key: TranscriberType) -> None:
    _last_used[key] = time.monotonic()


def unload_idle_transcribers(idle_seconds: float, now: float | None = None) -> list:
    """卸载闲置超过 idle_seconds 的转写器（释放显存），返回被卸载的类型列表。"""
    now = time.monotonic() if now is None else now
    unloaded = []
    with _transcriber_init_lock:
        for key, instance in list(_transcribers.items()):
            if instance is None:
                continue
            last = _last_used.get(key)
            if last is None or (now - last) < idle_seconds:
                continue
            closer = getattr(instance, "unload", None)
            if callable(closer):
                try:
                    closer()
                except Exception as e:
                    logger.warning(f"卸载 {key.value} 失败：{e}")
            _transcribers[key] = None
            _transcriber_configs[key] = None
            _last_used[key] = None
            unloaded.append(key)
    if unloaded:
        logger.info(f"显存回收：转写器闲置超过 {idle_seconds:.0f} 秒，已卸载 {[k.value for k in unloaded]}")
    return unloaded


def _start_idle_unloader() -> None:
    global _idle_unloader_started
    with _transcriber_init_lock:
        if _idle_unloader_started or IDLE_UNLOAD_SECONDS <= 0:
            return
        _idle_unloader_started = True

    def _loop():
        while True:
            time.sleep(IDLE_CHECK_SECONDS)
            try:
                unload_idle_transcribers(IDLE_UNLOAD_SECONDS)
            except Exception as e:  # 守护线程绝不能把进程带崩
                logger.warning(f"闲置卸载检查失败：{e}")

    threading.Thread(target=_loop, daemon=True, name="transcriber-idle-unload").start()
    logger.info(
        f"显存回收已启用：转写器闲置 {IDLE_UNLOAD_SECONDS:.0f} 秒后自动卸载"
        "（环境变量 WHISPER_IDLE_UNLOAD_SECONDS=0 可关闭）"
    )


# 公共实例初始化函数
def _init_transcriber(key: TranscriberType, cls, *args, **kwargs):
    init_config = (args, tuple(sorted(kwargs.items())))
    with _transcriber_init_lock:
        instance = _transcribers[key]
        if instance is None or _transcriber_configs[key] != init_config:
            action = "创建" if instance is None else "按新配置重新创建"
            logger.info(f'{action} {cls.__name__} 实例: {key}')
            try:
                new_instance = cls(*args, **kwargs)
            except Exception as e:
                logger.error(f"{cls.__name__} 创建失败: {e}")
                raise
            _transcribers[key] = new_instance
            _transcriber_configs[key] = init_config
            logger.info(f'{cls.__name__} 创建成功')
        instance = _transcribers[key]
    touch_transcriber(key)
    _start_idle_unloader()   # 必须在锁外调用：它会再拿一次锁
    return instance

# 各类型获取方法
def get_groq_transcriber():
    return _init_transcriber(TranscriberType.GROQ, GroqTranscriber)

def get_whisper_transcriber(model_size="base", device="cuda"):
    return _init_transcriber(TranscriberType.FAST_WHISPER, WhisperTranscriber, model_size=model_size, device=device)

def get_bcut_transcriber():
    return _init_transcriber(TranscriberType.BCUT, BcutTranscriber)

def get_kuaishou_transcriber():
    return _init_transcriber(TranscriberType.KUAISHOU, KuaishouTranscriber)

def get_mlx_whisper_transcriber(model_size="base"):
    if not MLX_WHISPER_AVAILABLE:
        logger.warning("MLX Whisper 不可用，请确保在 Apple 平台且已安装 mlx_whisper")
        raise ImportError("MLX Whisper 不可用")
    return _init_transcriber(TranscriberType.MLX_WHISPER, MLXWhisperTranscriber, model_size=model_size)

# 通用入口
def get_transcriber(transcriber_type="fast-whisper", model_size=None, device="cuda"):
    """
    获取指定类型的转录器实例

    参数:
        transcriber_type: 支持 "fast-whisper", "mlx-whisper", "bcut", "kuaishou", "groq"
        model_size: 模型大小，适用于 whisper 类；未提供时才读取环境变量默认值
        device: 设备类型（如 cuda / cpu），仅 whisper 使用

    返回:
        对应类型的转录器实例
    """
    logger.info(f'请求转录器类型: {transcriber_type}')

    try:
        transcriber_enum = TranscriberType(transcriber_type)
    except ValueError:
        logger.warning(f'未知转录器类型 "{transcriber_type}"，默认使用 fast-whisper')
        transcriber_enum = TranscriberType.FAST_WHISPER

    # The explicit value normally comes from the persisted frontend setting and
    # must take precedence over Docker's startup default.
    whisper_model_size = model_size or os.environ.get("WHISPER_MODEL_SIZE", "base")

    if transcriber_enum == TranscriberType.FAST_WHISPER:
        return get_whisper_transcriber(whisper_model_size, device=device)

    elif transcriber_enum == TranscriberType.MLX_WHISPER:
        if not MLX_WHISPER_AVAILABLE:
            raise RuntimeError(
                "MLX Whisper 不可用：需要 macOS 平台并安装 mlx_whisper 包 (pip install mlx_whisper)。"
                "请在「音频转写配置」页面切换到其他转写引擎。"
            )
        return get_mlx_whisper_transcriber(whisper_model_size)

    elif transcriber_enum == TranscriberType.BCUT:
        return get_bcut_transcriber()

    elif transcriber_enum == TranscriberType.KUAISHOU:
        return get_kuaishou_transcriber()

    elif transcriber_enum == TranscriberType.GROQ:
        return get_groq_transcriber()

    # fallback
    logger.warning(f'未识别转录器类型 "{transcriber_type}"，使用 fast-whisper 作为默认')
    return get_whisper_transcriber(whisper_model_size, device=device)
