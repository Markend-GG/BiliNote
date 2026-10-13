"""孤儿截图的自动清理：按天数 + 按孤儿总量两条规则，定时在后台跑。

两条规则都只在「孤儿集合」里生效——候选集由 library_service.scan_storage() 给出，
它只列没有任何笔记引用（清单 ∪ 正则都查不到）的文件，所以笔记里的正常截图
从一开始就不在候选里，不是靠阈值挡住的。真正的删除动作复用
delete_orphan_screenshots()，删除前会再算一次引用，期间被新笔记引用的会自动跳过。

策略与上次执行结果存 config/storage_cleanup.json（与 proxy.json 同一套约定，
config 是独立卷，重建容器不丢）。keep_days / max_orphan_mb 填 0 表示关掉对应那条规则。
"""

import json
import os
import threading
import time
from pathlib import Path

from app.services import library_service
from app.utils.logger import get_logger

logger = get_logger(__name__)

# 测试里会被重绑到临时目录，所以每次用都重新取模块属性，别在 import 期固化成 Path
POLICY_PATH = os.getenv("STORAGE_CLEANUP_CONFIG", "config/storage_cleanup.json")

# 首次延迟：避开启动时的回填/模型加载；之后每 24 小时一次
INITIAL_DELAY_SECONDS = 90
INTERVAL_SECONDS = 24 * 3600

DEFAULTS = {"enabled": True, "keep_days": 14, "max_orphan_mb": 800}

_started = False
_lock = threading.Lock()


def _read_raw() -> dict:
    path = Path(POLICY_PATH)
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        # 配置坏了不该让接口 500，退回默认值，下一次保存会覆盖掉坏文件
        logger.warning(f"读取自动清理配置失败，用默认值: {e}")
        return {}


def _write_raw(data: dict) -> None:
    path = Path(POLICY_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_policy() -> dict:
    raw = _read_raw()
    policy = dict(DEFAULTS)
    for key in DEFAULTS:
        if key in raw:
            policy[key] = raw[key]
    policy["enabled"] = bool(policy["enabled"])
    policy["keep_days"] = max(0, int(policy["keep_days"] or 0))
    policy["max_orphan_mb"] = max(0, int(policy["max_orphan_mb"] or 0))
    return policy


def save_policy(patch: dict) -> dict:
    """局部更新策略。写文件时保留 last_run，别把执行记录冲掉。"""
    policy = load_policy()
    if "enabled" in patch:
        policy["enabled"] = bool(patch["enabled"])
    if "keep_days" in patch:
        policy["keep_days"] = max(0, int(patch["keep_days"] or 0))
    if "max_orphan_mb" in patch:
        policy["max_orphan_mb"] = max(0, int(patch["max_orphan_mb"] or 0))
    raw = _read_raw()
    raw.update(policy)
    _write_raw(raw)
    logger.info(
        f"自动清理策略已更新：enabled={policy['enabled']} keep_days={policy['keep_days']} "
        f"max_orphan_mb={policy['max_orphan_mb']}"
    )
    return policy


def get_status() -> dict:
    return {"policy": load_policy(), "last_run": _read_raw().get("last_run")}


def run_auto_cleanup(reason: str = "schedule") -> dict:
    """跑一次自动清理。reason=schedule 时尊重开关，manual（界面上点按钮）总是执行。"""
    policy = load_policy()
    if reason == "schedule" and not policy["enabled"]:
        return {"skipped": "disabled", "deleted": 0, "freed_bytes": 0}

    scan = library_service.scan_storage()
    orphans = scan.get("orphans") or []
    now_ms = int(time.time() * 1000)

    aged, kept = [], []
    if policy["keep_days"] > 0:
        cutoff = now_ms - policy["keep_days"] * 86400 * 1000
        for item in orphans:
            (aged if item["mtime"] < cutoff else kept).append(item)
    else:
        kept = list(orphans)

    # 容量规则算的是「孤儿总量」，不是截图目录总量：被引用的截图既不计数也不参与删除
    over_cap = []
    cap_bytes = policy["max_orphan_mb"] * 1024 * 1024
    if cap_bytes > 0:
        excess = sum(item["size"] for item in kept) - cap_bytes
        if excess > 0:
            for item in sorted(kept, key=lambda x: x["mtime"]):  # 最旧的先走
                over_cap.append(item)
                excess -= item["size"]
                if excess <= 0:
                    break

    targets = aged + over_cap
    size_by_name = {item["name"]: item["size"] for item in targets}
    result = (
        library_service.delete_orphan_screenshots(list(size_by_name))
        if size_by_name
        else {"deleted": [], "skipped": []}
    )
    deleted = result["deleted"]
    freed = sum(size_by_name.get(name, 0) for name in deleted)

    remaining = [o for o in orphans if o["name"] not in set(deleted)]
    stats = {
        "at": now_ms,
        "reason": reason,
        "aged_deleted": len([n for n in deleted if n in {i["name"] for i in aged}]),
        "over_cap_deleted": len([n for n in deleted if n in {i["name"] for i in over_cap}]),
        "deleted": len(deleted),
        "skipped": len(result["skipped"]),
        "freed_bytes": freed,
        "remaining_orphans": len(remaining),
        "remaining_orphan_bytes": sum(o["size"] for o in remaining),
        "policy": policy,
    }

    raw = _read_raw()
    raw.update(policy)
    raw["last_run"] = stats
    try:
        _write_raw(raw)
    except Exception as e:
        logger.warning(f"写入自动清理记录失败: {e}")

    if deleted:
        logger.info(
            f"自动清理孤儿截图（{reason}）：删除 {len(deleted)} 张、释放 {freed / 1048576:.1f}MB，"
            f"其中超期 {stats['aged_deleted']} 张、超容量 {stats['over_cap_deleted']} 张；"
            f"剩余孤儿 {stats['remaining_orphans']} 张 / {stats['remaining_orphan_bytes'] / 1048576:.1f}MB"
        )
    else:
        logger.info(
            f"自动清理孤儿截图（{reason}）：无需清理，剩余孤儿 {stats['remaining_orphans']} 张"
        )
    return stats


def _loop() -> None:
    time.sleep(INITIAL_DELAY_SECONDS)
    while True:
        try:
            run_auto_cleanup("schedule")
        except Exception as e:
            # 后台线程里抛异常会静默死掉，之后再也不清理，必须兜住
            logger.error(f"自动清理失败: {e}", exc_info=True)
        time.sleep(INTERVAL_SECONDS)


def start_scheduler() -> bool:
    """启动后台清理线程（幂等）。在 main.py 的 lifespan 里调用。"""
    global _started
    with _lock:
        if _started:
            return False
        _started = True
    policy = load_policy()
    logger.info(
        f"孤儿截图自动清理已启动：enabled={policy['enabled']} keep_days={policy['keep_days']} "
        f"max_orphan_mb={policy['max_orphan_mb']}，首次 {INITIAL_DELAY_SECONDS}s 后执行、之后每 24h 一次"
    )
    threading.Thread(target=_loop, name="orphan-cleanup", daemon=True).start()
    return True
